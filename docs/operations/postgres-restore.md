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
