# CNPG → S3 Backups Design

**Date:** 2026-04-29
**Status:** Draft — pending review
**Scope:** Add disaster-recovery-grade S3 backups for both Postgres clusters running on the Hetzner k8s deployment.

## Goal

Currently both CNPG Postgres clusters (`app` main database and `lightrag-postgres`) persist data only to in-cluster PVCs. If a node dies or the cluster is rebuilt, all agent/user/knowledge data is lost.

This spec adds:

- **Off-cluster S3 backup** for both Postgres clusters
- **Point-in-Time Recovery (PITR)** for the main app DB (RPO ≈ minutes)
- **Nightly snapshot-only** for the LightRAG DB (RPO = 24h, accepted because LightRAG data is reproducible from source files)
- A documented **restore procedure** so future-us (or anyone on the team) can actually recover from a real incident.

## Non-goals

- Cross-region replication
- Encryption beyond S3 SSE-AES256 (no KMS CMK setup)
- Backups for non-Postgres data (LightRAG source files already live in `ranch-agent-data-*` S3 directly via the API)
- Automated restore drills in CI (manual quarterly drill is enough at this stage)

## Decisions

| Question | Choice | Rationale |
|---|---|---|
| Which clusters? | Both `app` postgres and `lightrag-postgres` | Full disaster recovery picture |
| Backup type | Hybrid: PITR for `app`, nightly-only for `lightrag` | LightRAG can be reindexed from source files; app DB can't |
| S3 bucket | One dedicated `ranch-pg-backups-<env>` | Clean separation from agent data; per-bucket lifecycle/billing |
| Retention | `retentionPolicy: "30d"` on both clusters (one daily ScheduledBackup each → ~30 daily snapshots + 30d of WAL for `app`) | CNPG's native retention is a single duration window, not tiered weekly/monthly. 30 daily snapshots is strictly more comprehensive than the 14d/4w/3m tiering originally proposed. |
| Auth | Static IAM access keys (existing `ranch-agent-<env>` user, scope extended) | Hetzner k8s, no IRSA available; reuse the existing user instead of creating a second one |
| Lifecycle to Glacier | Not now | Add later when stored size > ~500GB; current cost (~$4/mo) doesn't justify complexity |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Hetzner k8s cluster                  │
│                                                         │
│  ┌──────────────────┐         ┌──────────────────┐     │
│  │  app-postgres    │         │ lightrag-postgres│     │
│  │  (CNPG Cluster)  │         │  (CNPG Cluster)  │     │
│  └────────┬─────────┘         └────────┬─────────┘     │
│           │                            │                │
│           │ barmanObjectStore          │ barmanObjectStore
│           │ + WAL streaming            │ (base only)    │
│           │                            │                │
│  ┌────────┴────────────────────────────┴────────┐      │
│  │  Secret: pg-backup-aws (in platform ns)      │      │
│  │  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   │      │
│  └──────────────────────┬───────────────────────┘      │
│                         │                               │
│  ┌──────────────────────┴───────────────────────┐      │
│  │  ScheduledBackup CRDs:                       │      │
│  │   • app-postgres-daily   @ 02:00 UTC         │      │
│  │   • lightrag-postgres-daily @ 03:00 UTC      │      │
│  └──────────────────────────────────────────────┘      │
└──────────────────────────┼──────────────────────────────┘
                           │
                           ▼
            ┌──────────────────────────────┐
            │  AWS S3                       │
            │  ranch-pg-backups-<env>/      │
            │   ├─ app/                    │
            │   │   ├─ base/   (daily)     │
            │   │   └─ wals/   (PITR)      │
            │   └─ lightrag/               │
            │       └─ base/   (daily)     │
            └──────────────────────────────┘
```

## Components

### 1. Terraform — `terraform/modules/storage/main.tf`

**Add a second S3 bucket:**

```hcl
resource "aws_s3_bucket" "pg_backups" {
  bucket = "ranch-pg-backups-${var.environment}"
}

resource "aws_s3_bucket_versioning" "pg_backups" { ... Enabled ... }
resource "aws_s3_bucket_server_side_encryption_configuration" "pg_backups" { ... AES256 ... }
resource "aws_s3_bucket_public_access_block" "pg_backups" { ... all blocked ... }
```

**Extend the existing IAM user policy** (don't create a new one):

```hcl
statement {
  sid     = "PgBackupsBucketLevel"
  actions = ["s3:ListBucket", "s3:GetBucketLocation"]
  resources = [aws_s3_bucket.pg_backups.arn]
}
statement {
  sid = "PgBackupsObjectLevel"
  actions = [
    "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
    "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts",
  ]
  resources = ["${aws_s3_bucket.pg_backups.arn}/*"]
}
```

**Outputs:** `pg_backups_bucket_name`, `pg_backups_bucket_region`.

### 2. K8s Secret

**One Secret in `platform` namespace:**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: pg-backup-aws
  namespace: platform
type: Opaque
stringData:
  ACCESS_KEY_ID: <from terraform output>
  ACCESS_SECRET_KEY: <from terraform output>
```

Created via extending the existing `make k8s-secrets` make-target (interactive prompt for the access key + secret), same pattern as `lightrag-api` already uses.

### 3. App Postgres — `k8s/infrastructure/database/pg-cluster.yaml`

Add `spec.backup`:

```yaml
spec:
  backup:
    barmanObjectStore:
      destinationPath: s3://ranch-pg-backups-<env>/app
      s3Credentials:
        accessKeyId:
          name: pg-backup-aws
          key: ACCESS_KEY_ID
        secretAccessKey:
          name: pg-backup-aws
          key: ACCESS_SECRET_KEY
      wal:
        compression: gzip
      data:
        compression: gzip
        immediateCheckpoint: true
    retentionPolicy: "30d"
```

Plus `ScheduledBackup` resource in the same file:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: app-postgres-daily
  namespace: platform
spec:
  schedule: "0 0 2 * * *"   # 02:00 UTC daily
  cluster:
    name: app-postgres
  backupOwnerReference: self
```

### 4. LightRAG Postgres — `k8s/platform/lightrag/postgres.yaml`

Same structure but **no WAL archiving** (snapshot-only). Different schedule (03:00 UTC) so we don't double the egress at the same minute.

```yaml
spec:
  backup:
    barmanObjectStore:
      destinationPath: s3://ranch-pg-backups-<env>/lightrag
      s3Credentials: { ... same Secret refs ... }
      data:
        compression: gzip
        immediateCheckpoint: true
      # NO `wal:` block → WAL not archived
    retentionPolicy: "30d"
```

ScheduledBackup as `lightrag-postgres-daily` at `0 0 3 * * *`.

### 5. Restore docs — `docs/operations/postgres-restore.md` (new)

Step-by-step playbook for both:
- **App DB PITR:** "restore to 5 minutes before this timestamp" — using `Cluster.spec.bootstrap.recovery.recoveryTarget.targetTime`.
- **LightRAG snapshot restore:** "restore to last completed nightly".

Each scenario includes the exact YAML to apply, expected duration, and how to verify the restored cluster is healthy.

## Data flow

**Normal operation (steady state):**
1. App-postgres writes commits → CNPG ships each WAL segment to S3 within ~16MB or 60s (whichever first).
2. At 02:00 UTC every day → CNPG triggers a base backup of app-postgres → uploads to S3.
3. At 03:00 UTC every day → same for lightrag-postgres.
4. Anything older than retention policy is pruned automatically by CNPG.

**Disaster scenario (cluster lost):**
1. New k8s cluster comes up.
2. `pg-backup-aws` Secret recreated via `make k8s-secrets`.
3. New `Cluster` resource is applied with `spec.bootstrap.recovery.source: <previous cluster name>` referencing the same `barmanObjectStore` path.
4. CNPG pulls the latest base backup + replays WAL up to recovery target.
5. App reconnects to the restored DB.

## Cost

At current scale (~5GB total data, low write rate). CNPG/barman uses rsync-style incremental backups, so 30 daily copies don't multiply storage 30x — most data is shared between snapshots. Conservative upper bound:

| Item | Estimate |
|---|---|
| S3 storage (~150-250GB at retention peak) | $3.50-5.75/mo |
| PUT/GET requests | $0.04/mo |
| Egress (1 monthly restore drill, ~5GB) | $0.45/mo |
| **Total** | **~$4-7/mo** |

At 10x growth: ~$40-60/mo, at which point we revisit Glacier IA lifecycle policies.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| AWS keys leak from `pg-backup-aws` Secret | Keys are scoped to `ranch-pg-backups-<env>` + `ranch-agent-data-<env>` only (no other AWS access). Rotate via terraform `aws_iam_access_key` recreation. |
| Backup silently broken (no one notices) | Add a Prometheus alert on `cnpg_collector_last_available_backup_timestamp` (older than 36h = page) — *separate follow-up, not part of this spec*. |
| Restore not tested → broken when needed | Manual restore drill quarterly, documented in `postgres-restore.md`. |
| WAL backlog if S3 unreachable | CNPG buffers locally up to PVC limit; sets cluster status to degraded. Not solved here — accepted. |

## Open questions

None outstanding — all decisions resolved during brainstorm.

## Out of scope (follow-ups)

- Prometheus alerting on stale backups
- Automated restore drill in CI
- Cross-region replication
- KMS-managed encryption (instead of S3 SSE-AES256)
- Glacier IA lifecycle (revisit at >500GB stored)
