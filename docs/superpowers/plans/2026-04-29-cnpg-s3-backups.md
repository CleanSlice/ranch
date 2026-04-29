# CNPG → S3 Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add off-cluster S3 disaster-recovery backups for both Postgres clusters (`ranch-db` app DB with PITR, `lightrag-postgres` snapshot-only).

**Architecture:** Use CNPG's native `barmanObjectStore` to ship base backups + WAL to a dedicated S3 bucket. One terraform-managed bucket (`ranch-pg-backups-<env>`), credentials via the existing `ranch-agent-<env>` IAM user (policy extended), delivered to the cluster as a single Secret `pg-backup-aws`. Daily `ScheduledBackup` CRDs trigger backups; CNPG handles retention.

**Tech Stack:** Terraform (AWS provider), CloudNativePG (CNPG), Kubernetes, Make.

**Spec reference:** `docs/superpowers/specs/2026-04-29-cnpg-s3-backups-design.md`

**Note on testing:** This codebase has zero unit tests by design. Verification at each step is `terraform plan` diffs, `kubectl apply --dry-run=server` schema checks, and `aws s3 ls` / `kubectl get backup` after live apply.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `terraform/modules/storage/main.tf` | Modify | Add `pg_backups` bucket, extend IAM policy, add outputs |
| `terraform/environments/dreamvention/main.tf` | No change | Already wires `module.storage`; new outputs propagate automatically when consumed |
| `Makefile` | Modify | Extend `k8s-secrets` target with `pg-backup-aws` Secret creation |
| `k8s/infrastructure/database/pg-cluster.yaml` | Modify | Add `spec.backup.barmanObjectStore` (with WAL) + `ScheduledBackup` CRD |
| `k8s/platform/lightrag/postgres.yaml` | Modify | Add `spec.backup.barmanObjectStore` (no WAL) + `ScheduledBackup` CRD |
| `docs/operations/postgres-restore.md` | Create | Restore playbook for both clusters |

---

## Task 1: Terraform — add `ranch-pg-backups-<env>` bucket

**Files:**
- Modify: `terraform/modules/storage/main.tf`

- [ ] **Step 1: Add the bucket + hardening resources**

Insert after the `aws_s3_bucket_public_access_block.agent_data` block (around line 71):

```hcl
# ---------------------------------------------------------------------
# S3 bucket for Postgres backups (CNPG barmanObjectStore)
# ---------------------------------------------------------------------

resource "aws_s3_bucket" "pg_backups" {
  bucket = "ranch-pg-backups-${var.environment}"
}

resource "aws_s3_bucket_versioning" "pg_backups" {
  bucket = aws_s3_bucket.pg_backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pg_backups" {
  bucket = aws_s3_bucket.pg_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "pg_backups" {
  bucket = aws_s3_bucket.pg_backups.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}
```

- [ ] **Step 2: Extend IAM policy for the existing `ranch-agent-<env>` user**

Inside `data "aws_iam_policy_document" "agent_bucket_access"`, add two more `statement` blocks after the existing `SecretsManagerScoped` statement:

```hcl
statement {
  sid       = "PgBackupsBucketLevel"
  actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
  resources = [aws_s3_bucket.pg_backups.arn]
}

statement {
  sid = "PgBackupsObjectLevel"
  actions = [
    "s3:GetObject",
    "s3:PutObject",
    "s3:DeleteObject",
    "s3:AbortMultipartUpload",
    "s3:ListMultipartUploadParts",
  ]
  resources = ["${aws_s3_bucket.pg_backups.arn}/*"]
}
```

- [ ] **Step 3: Add outputs**

Append to the outputs section at the bottom of the file:

```hcl
output "pg_backups_bucket_name" {
  value = aws_s3_bucket.pg_backups.id
}

output "pg_backups_bucket_region" {
  value = aws_s3_bucket.pg_backups.region
}
```

- [ ] **Step 4: Plan in `dreamvention` env to verify diff**

Run:

```bash
cd terraform/environments/dreamvention && terraform plan
```

Expected: 4 new resources (`aws_s3_bucket.pg_backups`, `aws_s3_bucket_versioning.pg_backups`, `aws_s3_bucket_server_side_encryption_configuration.pg_backups`, `aws_s3_bucket_public_access_block.pg_backups`) plus 1 modified IAM policy (`aws_iam_user_policy.agent_bucket_access` — additional statements). No deletions, no changes to the existing `agent_data` bucket.

- [ ] **Step 5: Commit**

```bash
git add terraform/modules/storage/main.tf
git commit -m "feat(infra): add pg-backups s3 bucket and iam policy"
```

---

## Task 2: Terraform — apply in `dreamvention` env

**Files:**
- No file changes; this is an apply step.

- [ ] **Step 1: Apply**

Run from `terraform/environments/dreamvention`:

```bash
terraform apply
```

Confirm at the prompt. Expected: 4 created, 1 changed.

- [ ] **Step 2: Verify the bucket exists in AWS**

Run:

```bash
aws s3 ls | grep ranch-pg-backups
aws s3api get-bucket-versioning --bucket ranch-pg-backups-dreamvention
aws s3api get-bucket-encryption --bucket ranch-pg-backups-dreamvention
aws s3api get-public-access-block --bucket ranch-pg-backups-dreamvention
```

Expected: bucket listed; `Status: Enabled` for versioning; `AES256` for SSE; all four `BlockPublic*` flags `true`.

- [ ] **Step 3: Capture the IAM access key for the next task**

Run:

```bash
terraform output -raw access_key_id
terraform output -raw secret_access_key
```

Save to a scratchpad locally — they are needed for the `pg-backup-aws` Secret in Task 3. (These are the same keys already used by `ranch-agent-env` for agent S3 access — we reuse the user.)

---

## Task 3: Makefile — extend `k8s-secrets` to provision `pg-backup-aws`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add the secret block**

Find the `k8s-secrets` target in the Makefile (around line 215). After the `lightrag-api` secret creation block, append:

```makefile
	@echo "Creating pg-backup-aws secret in platform namespace..."
	@read -s -p "AWS access key id (for pg-backups): " ACCESS_KEY_ID; echo; \
	  read -s -p "AWS secret access key (for pg-backups): " ACCESS_SECRET_KEY; echo; \
	  kubectl -n platform create secret generic pg-backup-aws \
	    --from-literal=ACCESS_KEY_ID="$$ACCESS_KEY_ID" \
	    --from-literal=ACCESS_SECRET_KEY="$$ACCESS_SECRET_KEY" \
	    --dry-run=client -o yaml | kubectl apply -f -
	@echo "pg-backup-aws secret created."
```

- [ ] **Step 2: Verify Makefile syntax**

Run:

```bash
make -n k8s-secrets 2>&1 | head -40
```

Expected: prints the dry-run of all three secret-creation blocks (`ranch-api-env`, `lightrag-api`, `pg-backup-aws`) without errors.

- [ ] **Step 3: Apply against the live cluster (dreamvention)**

Make sure `KUBECONFIG` points to the dreamvention cluster, then:

```bash
make k8s-secrets
```

Enter the values when prompted. The two new prompts use the keys captured in Task 2 Step 3.

- [ ] **Step 4: Verify the Secret**

Run:

```bash
kubectl -n platform get secret pg-backup-aws -o jsonpath='{.data}' | jq 'keys'
```

Expected: `["ACCESS_KEY_ID", "ACCESS_SECRET_KEY"]`.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "feat(infra): add pg-backup-aws secret to k8s-secrets target"
```

---

## Task 4: LightRAG cluster — add backup config + ScheduledBackup

**Files:**
- Modify: `k8s/platform/lightrag/postgres.yaml`

- [ ] **Step 1: Add `spec.backup` block + ScheduledBackup**

Replace the entire contents of `k8s/platform/lightrag/postgres.yaml` with:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: lightrag-postgres
  namespace: platform
spec:
  instances: 1
  imageName: ghcr.io/cloudnative-pg/postgresql:16

  postgresql:
    parameters:
      shared_preload_libraries: "age"

  bootstrap:
    initdb:
      database: lightrag
      owner: lightrag
      postInitApplicationSQL:
        - CREATE EXTENSION IF NOT EXISTS vector;
        - CREATE EXTENSION IF NOT EXISTS age;
        - LOAD 'age';
        - SET search_path = ag_catalog, "$user", public;
      secret:
        name: lightrag-postgres-credentials

  storage:
    size: 20Gi

  backup:
    barmanObjectStore:
      destinationPath: s3://ranch-pg-backups-dreamvention/lightrag
      s3Credentials:
        accessKeyId:
          name: pg-backup-aws
          key: ACCESS_KEY_ID
        secretAccessKey:
          name: pg-backup-aws
          key: ACCESS_SECRET_KEY
      data:
        compression: gzip
        immediateCheckpoint: true
    retentionPolicy: "30d"
---
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: lightrag-postgres-daily
  namespace: platform
spec:
  schedule: "0 0 3 * * *"
  cluster:
    name: lightrag-postgres
  backupOwnerReference: self
```

Notes:
- `destinationPath` hardcodes `dreamvention` because that's the only environment currently using the storage module. If/when other envs adopt this, parameterise via Kustomize or per-env overlays — out of scope here.
- No `wal:` block under `barmanObjectStore` → snapshot-only, no PITR (matches spec).
- Schedule format is 6-field cron: `second minute hour day month weekday`. `0 0 3 * * *` = 03:00 UTC daily.

- [ ] **Step 2: Schema-validate against the cluster**

```bash
kubectl apply -f k8s/platform/lightrag/postgres.yaml --dry-run=server
```

Expected: two resources reported as configured (Cluster + ScheduledBackup), no schema errors. If you get "the server doesn't have a resource type 'ScheduledBackup'", CNPG operator isn't installed yet — install via the `cnpg` ArgoCD app first.

- [ ] **Step 3: Apply (or let ArgoCD sync)**

If letting ArgoCD sync: commit + push. If applying manually:

```bash
kubectl apply -f k8s/platform/lightrag/postgres.yaml
```

- [ ] **Step 4: Trigger an immediate one-off backup to validate end-to-end**

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: lightrag-postgres-test
  namespace: platform
spec:
  cluster:
    name: lightrag-postgres
EOF
```

Watch progress:

```bash
kubectl -n platform get backup lightrag-postgres-test -w
```

Expected: status transitions from `running` → `completed` within a couple of minutes.

- [ ] **Step 5: Verify the backup landed in S3**

```bash
aws s3 ls s3://ranch-pg-backups-dreamvention/lightrag/ --recursive | head -20
```

Expected: a `base/` directory with at least one timestamped folder containing `data.tar.gz` and `backup.info`.

- [ ] **Step 6: Clean up the test Backup CR**

```bash
kubectl -n platform delete backup lightrag-postgres-test
```

(Doesn't delete the S3 object — only the k8s resource.)

- [ ] **Step 7: Commit**

```bash
git add k8s/platform/lightrag/postgres.yaml
git commit -m "feat(infra): enable s3 backups for lightrag postgres"
```

---

## Task 5: App `ranch-db` cluster — add backup config + WAL + ScheduledBackup

**Files:**
- Modify: `k8s/infrastructure/database/pg-cluster.yaml`

- [ ] **Step 1: Add `spec.backup` block (with WAL) + ScheduledBackup**

Replace the entire contents of `k8s/infrastructure/database/pg-cluster.yaml` with:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: ranch-db
  namespace: platform
spec:
  instances: 1
  storage:
    size: 10Gi
  postgresql:
    parameters:
      max_connections: "200"

  backup:
    barmanObjectStore:
      destinationPath: s3://ranch-pg-backups-dreamvention/app
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
---
apiVersion: postgresql.cnpg.io/v1
kind: ScheduledBackup
metadata:
  name: ranch-db-daily
  namespace: platform
spec:
  schedule: "0 0 2 * * *"
  cluster:
    name: ranch-db
  backupOwnerReference: self
```

Note: `wal:` block IS present here → continuous WAL streaming → PITR enabled.

- [ ] **Step 2: Schema-validate**

```bash
kubectl apply -f k8s/infrastructure/database/pg-cluster.yaml --dry-run=server
```

Expected: two resources configured, no errors.

- [ ] **Step 3: Apply (or let ArgoCD sync)**

```bash
kubectl apply -f k8s/infrastructure/database/pg-cluster.yaml
```

- [ ] **Step 4: Verify WAL archiving is working**

After ~2 minutes, check:

```bash
kubectl -n platform exec -it ranch-db-1 -c postgres -- \
  psql -U postgres -c "SELECT * FROM pg_stat_archiver;"
```

Expected: `archived_count` > 0 and `last_archived_time` is recent (within a few minutes).

- [ ] **Step 5: Verify WAL is in S3**

```bash
aws s3 ls s3://ranch-pg-backups-dreamvention/app/ranch-db/wals/ --recursive | head
```

Expected: at least one `.gz` file under a numeric timeline directory (e.g. `0000000100000000/`).

- [ ] **Step 6: Trigger one-off base backup**

```bash
cat <<'EOF' | kubectl apply -f -
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  name: ranch-db-test
  namespace: platform
spec:
  cluster:
    name: ranch-db
EOF

kubectl -n platform get backup ranch-db-test -w
```

Wait for `completed`.

- [ ] **Step 7: Verify base backup in S3**

```bash
aws s3 ls s3://ranch-pg-backups-dreamvention/app/ranch-db/base/ --recursive | head
```

Expected: a timestamped folder with `data.tar.gz` and `backup.info`.

- [ ] **Step 8: Clean up test backup CR**

```bash
kubectl -n platform delete backup ranch-db-test
```

- [ ] **Step 9: Commit**

```bash
git add k8s/infrastructure/database/pg-cluster.yaml
git commit -m "feat(infra): enable s3 backups with pitr for ranch-db"
```

---

## Task 6: Restore playbook docs

**Files:**
- Create: `docs/operations/postgres-restore.md`

- [ ] **Step 1: Write the playbook**

Create `docs/operations/postgres-restore.md` with:

````markdown
# Postgres restore playbook

This document covers disaster recovery for the two CNPG clusters in `platform`:

- **`ranch-db`** — main app DB. PITR enabled (WAL archiving). Can restore to any point within the last 30 days.
- **`lightrag-postgres`** — knowledge-base DB. Snapshot-only. Can restore to last completed nightly snapshot (latest within ~24h).

Both back up to `s3://ranch-pg-backups-<env>/{app|lightrag}/`.

## Prerequisites

- `kubectl` pointed at the target cluster
- `pg-backup-aws` Secret exists in `platform` namespace (run `make k8s-secrets` if missing)
- CNPG operator installed in the cluster

## Scenario A: Restore `ranch-db` to a specific point in time

Use case: someone dropped a table or pushed bad migration 5 minutes ago.

1. **Stop traffic to the existing cluster** (scale ranch-api to 0):

   ```bash
   kubectl -n platform scale deployment ranch-api --replicas=0
   ```

2. **Pick the recovery target time** in RFC3339:

   ```
   TARGET=2026-04-29T14:35:00.000000+00:00
   ```

3. **Apply a recovery Cluster** (note: different name from the existing one — CNPG won't overwrite):

   ```yaml
   apiVersion: postgresql.cnpg.io/v1
   kind: Cluster
   metadata:
     name: ranch-db-restored
     namespace: platform
   spec:
     instances: 1
     storage:
       size: 10Gi
     bootstrap:
       recovery:
         source: ranch-db-backup
         recoveryTarget:
           targetTime: "2026-04-29T14:35:00.000000+00:00"
     externalClusters:
       - name: ranch-db-backup
         barmanObjectStore:
           destinationPath: s3://ranch-pg-backups-dreamvention/app
           s3Credentials:
             accessKeyId:
               name: pg-backup-aws
               key: ACCESS_KEY_ID
             secretAccessKey:
               name: pg-backup-aws
               key: ACCESS_SECRET_KEY
           wal:
             compression: gzip
   ```

4. **Watch the restore progress:**

   ```bash
   kubectl -n platform get cluster ranch-db-restored -w
   ```

   Expected: phase transitions to `Cluster in healthy state` within a few minutes (data volume dependent).

5. **Verify data:**

   ```bash
   kubectl -n platform exec -it ranch-db-restored-1 -c postgres -- \
     psql -U postgres -d ranch -c "SELECT count(*) FROM \"Agent\";"
   ```

6. **Cut over.** Two options:

   - **Quick (DNS swap):** Change `DATABASE_URL` in the `ranch-api-env` Secret to point at `ranch-db-restored-rw`, then scale `ranch-api` back up. Old `ranch-db` stays around as fallback until you're confident.

   - **Full swap:** Delete old `ranch-db`, rename `ranch-db-restored` → `ranch-db` via a fresh manifest. More disruptive.

7. **Scale ranch-api back up:**

   ```bash
   kubectl -n platform scale deployment ranch-api --replicas=1
   ```

## Scenario B: Restore `lightrag-postgres` from latest nightly

Use case: LightRAG DB is corrupt / cluster lost.

1. **Apply a recovery Cluster:**

   ```yaml
   apiVersion: postgresql.cnpg.io/v1
   kind: Cluster
   metadata:
     name: lightrag-postgres-restored
     namespace: platform
   spec:
     instances: 1
     imageName: ghcr.io/cloudnative-pg/postgresql:16
     postgresql:
       parameters:
         shared_preload_libraries: "age"
     storage:
       size: 20Gi
     bootstrap:
       recovery:
         source: lightrag-postgres-backup
         # No recoveryTarget → restores to latest available base backup
     externalClusters:
       - name: lightrag-postgres-backup
         barmanObjectStore:
           destinationPath: s3://ranch-pg-backups-dreamvention/lightrag
           s3Credentials:
             accessKeyId:
               name: pg-backup-aws
               key: ACCESS_KEY_ID
             secretAccessKey:
               name: pg-backup-aws
               key: ACCESS_SECRET_KEY
   ```

2. **Watch the restore:**

   ```bash
   kubectl -n platform get cluster lightrag-postgres-restored -w
   ```

3. **Cut over.** Update the `LIGHTRAG_*` env in `lightrag` Deployment to point at `lightrag-postgres-restored-rw`, then restart the lightrag pod.

## Scenario C: Full cluster lost (new k8s, new everything)

1. Provision new cluster via `make infra-apply ENV=<env>`.
2. Restore Secrets: `make k8s-secrets` (re-enter all credentials including pg-backup-aws).
3. Apply both Cluster manifests with `bootstrap.recovery` instead of `bootstrap.initdb`. Use the Scenario A and B manifests but rename them back to `ranch-db` / `lightrag-postgres`.
4. After CNPG completes restore, deploy ranch-api/admin/app via ArgoCD as usual.

## Verifying backups are healthy

Periodically (recommend monthly):

```bash
# Should show recent base backups
kubectl -n platform get backup
# Should show "lastAvailableBackup" within last 24h
kubectl -n platform get cluster ranch-db -o jsonpath='{.status.lastSuccessfulBackup}'
kubectl -n platform get cluster lightrag-postgres -o jsonpath='{.status.lastSuccessfulBackup}'
```

If `lastSuccessfulBackup` is older than 36h → backups are silently broken. Investigate the CNPG operator logs and the `pg-backup-aws` Secret.
````

- [ ] **Step 2: Verify the file renders correctly**

```bash
head -40 docs/operations/postgres-restore.md
```

Expected: clean Markdown, no broken backticks.

- [ ] **Step 3: Commit**

```bash
git add docs/operations/postgres-restore.md
git commit -m "docs: add postgres restore playbook"
```

---

## Task 7: Drill — actually do a test restore in dreamvention

**Files:**
- No file changes; this is a validation step. Skipping it leaves the playbook unproven.

- [ ] **Step 1: Restore `ranch-db` into a sidecar `ranch-db-drill`**

Follow Scenario A from the playbook, picking `targetTime` ≈ 5 minutes before now. Use `ranch-db-drill` as the cluster name (not `ranch-db-restored`) so it's clearly a drill.

- [ ] **Step 2: Verify the drill cluster has data**

```bash
kubectl -n platform exec -it ranch-db-drill-1 -c postgres -- \
  psql -U postgres -d ranch -c "\dt" | head
```

Expected: list of tables identical to the live `ranch-db`.

- [ ] **Step 3: Tear down the drill**

```bash
kubectl -n platform delete cluster ranch-db-drill
```

- [ ] **Step 4: Note the drill in the playbook**

Append to `docs/operations/postgres-restore.md`:

```markdown
## Drill log

- **2026-04-29** — Initial drill, ranch-db PITR restore took ~3 minutes. Procedure works. Performed by @ntorbinskiy.
```

(Update the date and the time-to-restore based on actual values.)

- [ ] **Step 5: Commit drill log**

```bash
git add docs/operations/postgres-restore.md
git commit -m "docs: log first restore drill"
```

---

## Done criteria

- [ ] `terraform apply` in `dreamvention` succeeds; `ranch-pg-backups-dreamvention` bucket exists and is private + versioned + encrypted
- [ ] `kubectl -n platform get secret pg-backup-aws` returns the secret with both keys
- [ ] `kubectl -n platform get cluster ranch-db -o yaml` shows `barmanObjectStore` with WAL config and `retentionPolicy: 30d`
- [ ] `kubectl -n platform get cluster lightrag-postgres -o yaml` shows `barmanObjectStore` without WAL and `retentionPolicy: 30d`
- [ ] Both `ScheduledBackup` resources exist
- [ ] `aws s3 ls s3://ranch-pg-backups-dreamvention/app/ranch-db/wals/` shows recent WAL segments
- [ ] At least one base backup exists for each cluster in S3
- [ ] `docs/operations/postgres-restore.md` exists and includes a drill log entry from a real restore
