# Ranch — Terraform deployment

Everything deployable is in Terraform: infra (k3s on Hetzner), platform add-ons
(ArgoCD, Argo Workflows, cert-manager, CNPG operator), and applications
(ranch-api, ranch-admin, agent WorkflowTemplate).

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
    ├── apps/                    # ranch-api + ranch-admin + agent workflow + secrets
    ├── database/                # (doc only — DB is CNPG or external Neon)
    └── dns/                     # outputs A-record list (DNS managed outside TF)
```

## Prerequisites

- `terraform >= 1.5`, `kubectl`, `helm`, `aws` CLI
- SSH key at `~/.ssh/ranch-hetzner` / `.pub` (for the cluster)
- AWS profile `cleanslice` configured via SSO (`~/.zshrc` exports `AWS_PROFILE=cleanslice`)
- A Hetzner Cloud API token
- A DNS zone for the domain (A-records managed externally)

Run `aws sso login --profile cleanslice` whenever the token expires.

## 0. One-time: remote state backend

Creates the S3 bucket + DynamoDB lock table used by every env. The backend's own
state stays local (chicken/egg — can't host it in the bucket it creates).

```bash
cd terraform/backend
terraform init
terraform apply
```

Outputs: `terraform_state_bucket`, `dynamodb_lock_table`, `backend_config_snippet`.

Bucket has versioning, AES256, public-access-block, `prevent_destroy = true`.

## 1. Deploy an existing environment (e.g. `dreamvention`)

### 1.1 Set sensitive variables

All secrets pass through Terraform via `TF_VAR_*` environment variables — never
put them in `terraform.tfvars` (state ends up in S3, tfvars might be shared).

First time: decide values for each. Recurring deploy: pull from the live cluster.

```bash
export KUBECONFIG=~/.kube/ranch/config   # or environments/dreamvention/k3s_kubeconfig.yaml

# Pull live values the cluster already has
export TF_VAR_database_url=$(kubectl -n platform get secret ranch-external-db -o jsonpath='{.data.uri}' | base64 -d)
export TF_VAR_jwt_secret=$(kubectl -n platform get secret ranch-secrets -o jsonpath='{.data.JWT_SECRET}' | base64 -d)
export TF_VAR_bridle_api_key=$(kubectl -n platform get secret ranch-secrets -o jsonpath='{.data.BRIDLE_API_KEY}' | base64 -d)
export TF_VAR_ghcr_username=dmitriyzhuk
export TF_VAR_ghcr_pat=<GH PAT with read:packages>
```

For a fresh install, generate them:

```bash
export TF_VAR_database_url='postgresql://...@neon.tech/neondb?sslmode=require'
export TF_VAR_jwt_secret=$(openssl rand -base64 48 | tr -d '\n/+' | head -c 40)
export TF_VAR_bridle_api_key=$(openssl rand -base64 48 | tr -d '\n/+' | head -c 40)
export TF_VAR_ghcr_username=dmitriyzhuk
export TF_VAR_ghcr_pat=<GH PAT with read:packages>
```

Tip: keep these in `~/.zshrc` sourced from a non-committed file, or use 1Password /
AWS Secrets Manager and pipe in.

### 1.2 Apply

```bash
cd terraform/environments/dreamvention
terraform init       # downloads providers, connects to S3 backend
terraform plan       # review diff
terraform apply      # ~5–10 min fresh, ~30 s on updates
```

A fresh apply creates:

- k3s control plane VM on Hetzner (`cx33`, nbg1)
- Load balancer + firewall (with outbound :5432 for Neon)
- Traefik, cert-manager, hcloud-CCM, hcloud-CSI (via kube-hetzner)
- ArgoCD + Argo Workflows + CNPG operator
- Namespaces `platform`, `agents`, ClusterIssuer `letsencrypt-prod`
- Secrets: `ghcr`, `ranch-secrets`, `ranch-external-db`
- `ranch-api` (with init-container running `prisma migrate deploy`)
- `ranch-admin`
- Ingresses with Let's Encrypt TLS for `{domain}`, `api.{domain}`, `argocd.{domain}`
- `agents/workflow` ServiceAccount + RBAC + WorkflowTemplate `agent-deployment`

### 1.3 DNS (manual)

`modules/dns` only outputs the list of records. Add these A-records at your
DNS provider pointing at `module.cluster.load_balancer_ip`:

| Host | Purpose |
|---|---|
| `{domain}` | Admin UI |
| `api.{domain}` | API + bridle WS |
| `argocd.{domain}` | GitOps UI |

`cleanslice.org` lives in DigitalOcean DNS. The API tokens for DNS stay outside
Terraform for now — managed manually or via the DO console.

### 1.4 First owner

Once `https://{domain}/` loads the `/setup` page, create the first owner
(name/email/password). Then in **Settings** fill:

- `integrations/claude_code_oauth_token` OR `anthropic_api_key` (for LLM)
- `integrations/bridle_url`, `bridle_api_key` (bridle hub — optional, defaults work)
- `integrations/s3_*` (for agent state persistence — optional)

## 2. Update an image

```bash
# Build + push (on the Hetzner server or wherever):
cd /root/build/ranch-api && podman build -t ghcr.io/dmitriyzhuk/ranch-api:v1.2 . && podman push ghcr.io/dmitriyzhuk/ranch-api:v1.2

# Bump the tag in TF:
export TF_VAR_api_image=ghcr.io/dmitriyzhuk/ranch-api:v1.2
cd terraform/environments/dreamvention
terraform apply
```

Or set defaults in `variables.tf` of the env if you don't want to pass each time.

Latest tag with `imagePullPolicy: Always` works for fast-moving dev (deployment
pulls fresh on every restart), but pin to a SHA / semver for reproducible prod.

## 3. Rotate a secret

Any of the `TF_VAR_*` secrets (JWT, BRIDLE_API_KEY, PAT, database_url) rotates
the same way:

```bash
export TF_VAR_jwt_secret=$(openssl rand -base64 48 | tr -d '\n/+' | head -c 40)
terraform apply
```

Terraform replaces the secret; `ranch-api` Deployment has `strategy: Recreate`
so it restarts on config change.

## 4. Create a new environment

```bash
cp -r environments/dreamvention environments/myenv
cd environments/myenv
$EDITOR terraform.tfvars          # set hcloud_token, domain, admin_ip
# update the S3 backend key to "myenv/terraform.tfstate" in main.tf
terraform init
# set TF_VAR_* (§1.1)
terraform apply
```

## 5. Migrate an env from local state to S3

If `backend "local"` is still in the main.tf:

1. Replace with:
   ```hcl
   backend "s3" {
     bucket         = "ranch-terraform-state"
     key            = "<env>/terraform.tfstate"
     region         = "us-east-1"
     dynamodb_table = "ranch-terraform-locks"
     encrypt        = true
   }
   ```

2. `terraform init -migrate-state` — answer `yes`.

3. Keep the local `terraform.tfstate` as a fallback for one apply cycle, then delete.

## 6. What each module owns

| Module | Creates | Triggers pod restart? |
|---|---|---|
| `network` | `hcloud_network` ranch-{env}, firewall for admin_ip | no |
| `cluster` | k3s control plane, LB, MicroOS image, CCM/CSI/Traefik/cert-manager (via kube-hetzner) | yes (new node) |
| `bootstrap` | Namespaces, ArgoCD, Argo Workflows, CNPG operator, ClusterIssuer | helm upgrade restarts pods |
| `apps` | Secrets, ranch-api, ranch-admin, workflow SA+RBAC, WorkflowTemplate | yes (on image / env change) |
| `dns` | **nothing** — outputs A-record targets | — |

## 7. Kubeconfig

`kube-hetzner` writes kubeconfig to `environments/<env>/k3s_kubeconfig.yaml`
on apply. Keep it handy:

```bash
export KUBECONFIG=$(pwd)/environments/<env>/k3s_kubeconfig.yaml
kubectl get nodes
```

## 8. Common pitfalls

- **`ExpiredToken` / `InvalidClientTokenId` from AWS** — SSO session expired.
  `aws sso login --profile cleanslice`.

- **State lock stuck ("resource temporarily unavailable")** after a crashed run:
  ```bash
  terraform force-unlock <lock-id>          # shown in error
  # or emergency single-shot: add `-lock=false` to one command
  ```

- **Helm release drift on import** — after `terraform import helm_release.X`,
  `repository` is empty in state. First `apply` adds it in-place (no restart).

- **Argo CD chart 9.x ingress format** — uses `server.ingress.hostname` (single
  string) + `tls: true`, NOT `hosts: [...]` + `tls: [...]`. Wrong format silently
  produces `argocd.example.com`.

- **Pod can't reach Neon (`P1001`)** — the kube-hetzner firewall needs outbound
  tcp/5432. Already set via `extra_firewall_rules` in `modules/cluster/main.tf`.
  Check the firewall isn't reverted: `terraform plan` should show no diff on it.

- **kubectl provider can't connect ("localhost refused")** — the `config_path`
  must point at the file, not at the module output `kubeconfig` (which is
  content, not a path). `environments/<env>/main.tf` already does this.

## 9. CI/CD (GitHub Actions)

Two workflows in `.github/workflows/`:

| File | Trigger | What it does |
|---|---|---|
| `build-images.yaml` | push to `main` on `api/**` or `admin/**` (+ manual) | builds + pushes `ghcr.io/dmitriyzhuk/ranch-{api,admin}:{latest,<sha>}`, then `kubectl rollout restart` the affected Deployment |
| `terraform.yaml` | PR on `terraform/**` → plan; manual dispatch → plan or apply | runs TF against `environments/dreamvention` |
| `ci.yaml` | every PR/push | lint + test (bun) |

`build-images.yaml` keeps deploys fast (~2 min) and never touches cluster state.
`terraform.yaml` is manual-apply only — TF changes (firewall, secrets rotation,
node resize) should be explicit, not triggered by a commit.

### Required repository secrets

Set via `gh secret set NAME` (or UI → Settings → Secrets and variables → Actions).

| Secret | Used by | Value |
|---|---|---|
| `GHCR_PAT` | build-images | GitHub PAT with `write:packages`, `read:packages` (push images to ghcr.io/dmitriyzhuk) |
| `KUBECONFIG_B64` | build-images | `base64 -i environments/dreamvention/k3s_kubeconfig.yaml` |
| `HCLOUD_TOKEN` | terraform | Hetzner Cloud API token (read-write) |
| `AWS_ACCESS_KEY_ID` | terraform | For S3 state backend (or use OIDC) |
| `AWS_SECRET_ACCESS_KEY` | terraform | — |
| `TF_VAR_DATABASE_URL` | terraform | Neon direct URL (not pooler), `sslmode=require&channel_binding=require` |
| `TF_VAR_JWT_SECRET` | terraform | — |
| `TF_VAR_BRIDLE_API_KEY` | terraform | — |
| `TF_VAR_GHCR_PAT` | terraform | Same PAT as `GHCR_PAT` — used to build the imagePullSecret in-cluster |

### Required repository variables

Set via `gh variable set NAME --body VALUE`.

| Variable | Used by | Example |
|---|---|---|
| `API_URL` | build-images (admin build arg) | `https://api.ranch.cleanslice.org` |
| `DOMAIN` | terraform | `ranch.cleanslice.org` |
| `ADMIN_IP` | terraform | your IP for SSH allow-list, e.g. `1.2.3.4/32` |
| `GHCR_USERNAME` | terraform | `dmitriyzhuk` |
| `API_IMAGE` | terraform | `ghcr.io/dmitriyzhuk/ranch-api:latest` |
| `ADMIN_IMAGE` | terraform | `ghcr.io/dmitriyzhuk/ranch-admin:latest` |

### One-shot setup

```bash
cd ranch

# secrets
echo "<ghcr-pat>"   | gh secret set GHCR_PAT
base64 -i terraform/environments/dreamvention/k3s_kubeconfig.yaml | gh secret set KUBECONFIG_B64
echo "<hcloud>"     | gh secret set HCLOUD_TOKEN
echo "<aws-key>"    | gh secret set AWS_ACCESS_KEY_ID
echo "<aws-secret>" | gh secret set AWS_SECRET_ACCESS_KEY
echo "$TF_VAR_database_url"    | gh secret set TF_VAR_DATABASE_URL
echo "$TF_VAR_jwt_secret"      | gh secret set TF_VAR_JWT_SECRET
echo "$TF_VAR_bridle_api_key"  | gh secret set TF_VAR_BRIDLE_API_KEY
echo "<ghcr-pat>"              | gh secret set TF_VAR_GHCR_PAT

# variables
gh variable set API_URL       --body "https://api.ranch.cleanslice.org"
gh variable set DOMAIN        --body "ranch.cleanslice.org"
gh variable set ADMIN_IP      --body "<your-ip>/32"
gh variable set GHCR_USERNAME --body "dmitriyzhuk"
gh variable set API_IMAGE     --body "ghcr.io/dmitriyzhuk/ranch-api:latest"
gh variable set ADMIN_IMAGE   --body "ghcr.io/dmitriyzhuk/ranch-admin:latest"
```

### Typical flow

1. Push a code change to `api/` or `admin/` → `build-images` builds, pushes, restarts the Deployment. Smoke-tests the public endpoint at the end.
2. Open a PR touching `terraform/` → `terraform.yaml` runs `plan` on the PR.
3. After merging, run `gh workflow run terraform.yaml -f action=apply` to apply (or use the Actions UI).

### Kubeconfig rotation

If you rebuild the cluster, update `KUBECONFIG_B64`:

```bash
base64 -i terraform/environments/dreamvention/k3s_kubeconfig.yaml | gh secret set KUBECONFIG_B64
```
