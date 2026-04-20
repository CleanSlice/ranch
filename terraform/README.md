# Ranch — Terraform deployment

Everything lives here: remote state backend, per-environment modules, and reusable building blocks.

```
terraform/
├── backend/                     # S3 + DynamoDB for remote state (bootstrap)
├── environments/
│   ├── dev/                     # local k3d — not production
│   ├── dreamvention/            # production env on Hetzner
│   └── prod/                    # template for a new prod env
└── modules/
    ├── network/                 # hcloud_network + firewall
    ├── cluster/                 # kube-hetzner (k3s + traefik + cert-manager)
    ├── bootstrap/               # argocd, argo-workflows, cnpg, namespaces, ClusterIssuer
    ├── database/                # (doc only — DB is via CNPG or external Neon)
    └── dns/                     # outputs A-record list (DNS managed outside TF)
```

## AWS profile

All AWS calls (S3 backend + DynamoDB locks) go through the `cleanslice` profile.
`~/.zshrc` exports `AWS_PROFILE=cleanslice` at shell open; any new terminal is ready.

## 1. Create the remote state backend (one-time)

Bootstraps the S3 bucket + DynamoDB table that every env will use to store its state.
State of the backend itself lives in a **local** file next to `main.tf` — you can't
store the backend's state in the bucket it is creating (chicken/egg).

```bash
cd terraform/backend
terraform init
terraform apply
```

Outputs:
- `terraform_state_bucket` — `ranch-terraform-state`
- `dynamodb_lock_table` — `ranch-terraform-locks`
- `backend_config_snippet` — a ready-to-paste `backend "s3" { ... }` block

The bucket has versioning, AES256 encryption, public-access-block, and
`lifecycle.prevent_destroy = true` (state loss = cluster management loss).

## 2. Migrate an environment onto remote state

If an env currently has `backend "local"`:

1. Replace the block in `environments/<env>/main.tf` with:
   ```hcl
   terraform {
     backend "s3" {
       bucket         = "ranch-terraform-state"
       key            = "<env>/terraform.tfstate"
       region         = "us-east-1"
       dynamodb_table = "ranch-terraform-locks"
       encrypt        = true
     }
   }
   ```

2. Run:
   ```bash
   cd terraform/environments/<env>
   terraform init -migrate-state
   ```
   Terraform asks to copy the existing local state to S3 — answer `yes`.
   Keep the local `terraform.tfstate` for one apply cycle as a fallback, then delete.

## 3. Create a new environment

```bash
cp -r environments/dev environments/myenv
cd environments/myenv
cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars   # set hcloud_token, domain, admin_ip, ssh key paths
# Point to remote state (see §2)
terraform init
terraform apply            # ~5–10 min for k3s + add-ons
```

See `../README.md` (main) for prereqs (kube-hetzner MicroOS snapshot, packer, etc).

## 4. Apply changes to an existing environment

```bash
cd terraform/environments/<env>
terraform plan    # always review first
terraform apply
```

DynamoDB enforces one `apply` at a time across all users. If a previous run crashed
and left a stale lock: `terraform force-unlock <lock-id>`.

## 5. What Terraform manages vs not

Managed via TF (module `bootstrap`):

- Namespaces `platform`, `agents`
- Helm releases: `argocd`, `argo-workflows`, `cnpg`
- `ClusterIssuer letsencrypt-prod`

Managed via TF (module `cluster`, via kube-hetzner):

- k3s cluster, Traefik, cert-manager, hcloud-ccm/csi
- Firewall with outbound `tcp/5432` (Neon / external Postgres)

**Not in TF — applied manually via `kubectl`** (see `k8s/deploy/`):

- `ghcr` imagePullSecret, `ranch-secrets`, `ranch-external-db` (Neon URL)
- `ranch-api` / `ranch-admin` Deployments + Services + Ingresses
- WorkflowTemplate `agent-deployment` in `agents`

These can be moved into Terraform (or into an ArgoCD `Application` pointing at
this repo) later.

## 6. DNS

This project does **not** manage DNS via Terraform. The `dns` module only outputs
the list of A-records the env needs. For the `dreamvention` env on `cleanslice.org`:

| Host | Type | Target |
|---|---|---|
| `ranch.cleanslice.org` | A | `46.225.62.248` |
| `api.ranch.cleanslice.org` | A | `46.225.62.248` |
| `argocd.ranch.cleanslice.org` | A | `46.225.62.248` |

Managed in DigitalOcean DNS.

## 7. Kubeconfig

`kube-hetzner` writes the kubeconfig to `environments/<env>/k3s_kubeconfig.yaml`.
Keep a symlink for kubectl:

```bash
export KUBECONFIG=$(pwd)/environments/<env>/k3s_kubeconfig.yaml
kubectl get nodes
```

## 8. Common pitfalls

- **State lock "resource temporarily unavailable"** after an IDE force-quits TF:
  ```bash
  rm -f .terraform.tfstate.lock.info
  # or use -lock=false for the next single command
  ```

- **Helm release drift on import** — after `terraform import helm_release.X`,
  the `repository` attribute is empty in state. First `apply` after import adds
  it (in-place, no pod restarts). This is expected.

- **Pod can't reach Neon** — ensure the kube-hetzner firewall has outbound
  `tcp/5432` (already in `modules/cluster/main.tf` via `extra_firewall_rules`).
  If you see `P1001: Can't reach database server` from a Prisma migration pod,
  verify the rule actually applied: `terraform plan` should show no diff on the
  firewall.
