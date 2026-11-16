# Deploy

## Deploy to Hetzner Cloud

> 📘 Full Terraform guide (remote state backend, environments, imports, DNS, gotchas):
> [`terraform/README.md`](../../terraform/README.md)

### 1. Create Your Environment

```bash
# Copy the dev template
cp -r terraform/environments/dev terraform/environments/myenv

# Edit variables
vi terraform/environments/myenv/terraform.tfvars.example
# Copy and fill in your values:
cp terraform/environments/myenv/terraform.tfvars.example terraform/environments/myenv/terraform.tfvars
```

Required variables in `terraform.tfvars`:

```hcl
hcloud_token        = "your-hetzner-api-token"
domain              = "ranch.yourdomain.com"
admin_ip            = "YOUR_IP/32"          # curl ifconfig.me
ssh_public_key_path = "~/.ssh/id_ed25519.pub"
```

### 2. Create MicroOS Snapshots (first time only)

The k3s cluster requires MicroOS snapshots on Hetzner:

```bash
brew install packer   # if not installed

# Download and build snapshots
cd /tmp
curl -sLO https://raw.githubusercontent.com/kube-hetzner/terraform-hcloud-kube-hetzner/master/packer-template/hcloud-microos-snapshots.pkr.hcl
packer init hcloud-microos-snapshots.pkr.hcl
HCLOUD_TOKEN="your-token" packer build hcloud-microos-snapshots.pkr.hcl
```

### 3. Provision Infrastructure

```bash
make infra-init ENV=myenv    # Download providers
make infra-plan ENV=myenv    # Preview changes
make infra-apply ENV=myenv   # Create cluster (~5-10 min)
```

This creates:
- k3s cluster with Traefik ingress and cert-manager
- VPC + Firewall
- Load Balancer

### 4. Get Kubeconfig

```bash
make kubeconfig ENV=myenv
export KUBECONFIG=~/.kube/ranch-myenv
kubectl get nodes
```

### 5. Install Platform Services

```bash
# Add Helm repos
helm repo add argo https://argoproj.github.io/argo-helm
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update

# Install ArgoCD
helm install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --set server.ingress.enabled=true \
  --set server.ingress.ingressClassName=traefik \
  --set "server.ingress.hosts[0]=argocd.ranch.yourdomain.com"

# Install Argo Workflows
helm install argo-workflows argo/argo-workflows \
  --namespace argo --create-namespace

# Install CloudNativePG
helm install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system --create-namespace

# Create namespaces
kubectl create namespace platform
kubectl create namespace agents
```

### 6. Configure DNS

Ranch ships five public services behind one shared Hetzner Load Balancer.
You need an **A record per subdomain** at your DNS provider — the records
themselves are not managed by Terraform (intentional: keeps the DNS zone
your single source of truth and lets you change provider without touching
the platform module).

**Required A records** — point each at the same Load Balancer IP:

| Subdomain                       | Serves                       | Required? |
|---------------------------------|------------------------------|-----------|
| `ranch.yourdomain.com`          | App (root, end-user UI)      | yes       |
| `api.ranch.yourdomain.com`      | NestJS API                   | yes       |
| `admin.ranch.yourdomain.com`    | Admin panel (Nuxt)           | yes       |
| `argocd.ranch.yourdomain.com`   | ArgoCD UI                    | yes       |
| `browser.ranch.yourdomain.com`  | Browser-pool live VNC view   | yes — agents send users this URL for manual logins (Instagram, Meta Ads, etc.). Without it, every site that needs an interactive login is unreachable. |

Get the Load Balancer IP after `terraform apply`:

```bash
kubectl get svc -n traefik traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
# or, equivalently, ask Terraform:
terraform -chdir=terraform/environments/<env> output dns_records_needed
```

The `dns_records_needed` output lists every subdomain that needs a record
and the IP to point it at — keep this in sync if you ever add a new
public-facing ingress (otherwise `cert-manager` will spin forever on a
challenge that can't resolve).

**Propagation**: 1–5 min typical (set TTL=300). `cert-manager` then
issues a Let's Encrypt cert automatically via the HTTP-01 challenge —
the first hit to `https://<subdomain>/` after propagation triggers it.

**Smoke test once propagated**:

```bash
for sub in "" api. admin. argocd. browser.; do
  host="${sub}ranch.yourdomain.com"
  printf "%-45s " "$host"
  curl -sS -o /dev/null -w "%{http_code}\n" "https://$host/" --max-time 5 || echo "(timeout)"
done
```

All five should return a non-zero HTTP code (200/301/302/401 are all fine —
means the cert handshake succeeded and Traefik routed the request).

### 7. Connect ArgoCD to Repository

```bash
# Get ArgoCD password
make argocd-password

# Login to ArgoCD UI at https://argocd.ranch.yourdomain.com
# Username: admin
# Password: <output from above>

# Deploy app-of-apps
make deploy
```

### 8. Create Secrets

```bash
make k8s-secrets   # Interactive — will ask for DATABASE_URL
```

## Forking for Your Organization

Ranch is designed to be forked per-organization:

```bash
# 1. Fork CleanSlice/ranch → YourOrg/ranch

# 2. Clone your fork
git clone git@github.com:YourOrg/ranch.git
cd ranch

# 3. Add upstream
git remote add upstream git@github.com:CleanSlice/ranch.git

# 4. Create your environment
cp -r terraform/environments/dev terraform/environments/yourenv

# 5. Customize k8s manifests
# - k8s/argocd/app-of-apps.yaml → change repoURL to YourOrg/ranch
# - k8s/platform/*/ingress.yaml → change hostnames
# - k8s/platform/*/deployment.yaml → change image registry
# - Makefile → change ENV default

# 6. Sync upstream changes
git fetch upstream
git merge upstream/main
git push origin main
```

## Cluster Management

```bash
make k8s-status       # Show nodes, pods, ArgoCD apps
make k8s-logs-api     # Tail API logs
make argocd-password  # Get ArgoCD admin password
make infra-destroy ENV=myenv   # Tear down infrastructure
```

## GitOps Flow

```
git push → GitHub Actions:
  ├── CI (lint + test)
  ├── Build Docker images → ghcr.io
  └── ArgoCD detects new image
        └── Syncs to cluster (zero-downtime rolling update)
```

ArgoCD manages:
- **Infrastructure** — Argo Workflows, CloudNativePG, PostgreSQL cluster
- **Platform** — API, App, Admin deployments
- **Templates** — Argo WorkflowTemplates for agent pods
