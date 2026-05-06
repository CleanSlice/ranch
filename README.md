![Ranch](docs/cleanslice-ranch-banner.png)

# Ranch

Agent deployment platform on Kubernetes. Deploy, manage, and monitor AI agents at scale.

**Live demo:** [ranch.cleanslice.org](https://ranch.cleanslice.org/)

Built with [CleanSlice](https://github.com/CleanSlice) architecture.

## Quick Start

Install the CLI globally — it auto-clones the project on first run:

```bash
bun add -g @cleanslice/ranch
# or: npm install -g @cleanslice/ranch

ranch dev    # offers to clone if no checkout, then starts api + app + admin + local k3d
```

See [`cli/README.md`](cli/README.md) for all `ranch` commands.

### Or clone manually

```bash
git clone https://github.com/CleanSlice/ranch.git
cd ranch
make init
```

The setup wizard will guide you through:
1. Installing dependencies (Bun, Docker)
2. Setting up local PostgreSQL and running migrations
3. Optionally: configuring and deploying to Hetzner Cloud

After setup, start developing:

```bash
make dev    # Starts api:3000 + app:3001 + admin:3002
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Hetzner Cloud                        │
│                                                         │
│  ┌────────────┐  ┌────────────────┐  ┌───────────────┐  │
│  │  ArgoCD    │  │ Argo Workflows │  │  CloudNativePG│  │
│  │  (GitOps)  │  │ (Agent runs)   │  │  (PostgreSQL) │  │
│  └─────┬──────┘  └──────▲─────────┘  └───────────────┘  │
│        │ sync           │ submit                        │
│        ▼                │                               │
│  ┌──────────────────────┴──────────────────────────┐    │
│  │           Agent Manager (api)                   │    │
│  │  NestJS + Prisma + CleanSlice                   │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │  Dashboard (app)│  │   Admin Panel (admin)       │   │
│  │  Nuxt + Vue 3   │  │   Nuxt + Vue 3              │   │
│  └─────────────────┘  └─────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Agent Pods (dynamic, via Argo Workflows)        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | NestJS, Prisma, PostgreSQL |
| Frontend | Nuxt 3, Vue 3, Pinia, Tailwind, shadcn-vue |
| Infrastructure | Terraform, Hetzner Cloud, k3s |
| Deployment | ArgoCD (GitOps), Argo Workflows |
| Runtime | Bun |
| Monorepo | Turborepo |

## Project Structure

```
ranch/
├── api/                  # NestJS backend
│   └── src/slices/
│       ├── setup/        #   prisma, init, health
│       ├── user/         #   auth + user
│       ├── agent/        #   agent, file, pod, secret, template, templateFile
│       ├── workflow/     #   Argo Workflows integration
│       ├── bridle/       #   chat (sessions, messages, streaming)
│       ├── mcp/          #   MCP runtime hosted at /mcp/*
│       ├── mcpServer/    #   MCP server registry
│       ├── llm/          #   LLM provider config
│       ├── skill/        #   Reusable agent skills
│       ├── rancher/      #   Per-tenant ranch (workspace) management
│       ├── reins/        #   Access control / API keys
│       ├── setting/      #   System settings
│       ├── usage/        #   Usage metering
│       ├── log/          #   Agent logs
│       └── aws/          #   AWS-backed integrations (S3, etc.)
├── app/                  # Nuxt user dashboard
│   └── slices/           #   setup, agent, bridle, template, user, common
├── admin/                # Nuxt admin panel
│   └── slices/           #   setup, agent, bridle, llm, mcpServer, rancher,
│                         #   reins, setting, skill, usage, user, common
├── cli/                  # @cleanslice/ranch — published to npm
├── rancher/              # Default agent template ("rancher" agent)
├── terraform/            # Hetzner infrastructure
│   ├── modules/          #   cluster, network, bootstrap, dns, database, storage, apps
│   └── environments/     #   dev, prod, dreamvention (+ your custom env)
├── k8s/                  # Kubernetes manifests
│   ├── argocd/           #   App-of-apps
│   ├── infrastructure/   #   Argo Workflows, CNPG, database
│   ├── platform/         #   api, app, admin deployments
│   ├── templates/        #   Argo WorkflowTemplate + RBAC for agents
│   ├── local/            #   Local k3d-only manifests (CoreDNS host alias, etc.)
│   └── deploy/           #   Deploy hooks
└── .github/workflows/    # CI/CD
```

## Prerequisites

- [Bun](https://bun.sh/) — `curl -fsSL https://bun.sh/install | bash`
- [Docker](https://docs.docker.com/get-docker/) — for local PostgreSQL
- [Terraform](https://developer.hashicorp.com/terraform/install) — for infrastructure
- [kubectl](https://kubernetes.io/docs/tasks/tools/) — for cluster management
- [Helm](https://helm.sh/docs/intro/install/) — for chart management

## Local Development

### Recommended: `ranch` CLI

The `ranch` CLI wraps the most-used `make` targets and works from any
directory once installed globally. See [`cli/README.md`](cli/README.md)
for the full reference.

```bash
bun add -g @cleanslice/ranch       # one-time install

ranch dev                          # start api + app + admin
ranch dev api                      # or just one service: api | app | admin
ranch down                         # stop dev servers, postgres, k3d
ranch db start | stop | reset | studio
ranch generate                     # regenerate Prisma schema from slices
ranch status                       # show what's running locally
ranch where                        # show which Ranch checkout the CLI is using
```

### Or: `make` from inside the repo

Equivalent targets, run from the project root:

```bash
make help             # Show all commands

# Development
make setup            # Full local setup (first time)
make dev              # Start all services (api:3000, app:3001, admin:3002)
make dev-api          # Start API only
make dev-app          # Start app only
make dev-admin        # Start admin only

# Database
make db               # Start PostgreSQL via Docker
make db-stop          # Stop PostgreSQL
make db-reset         # Reset database (destroy data)
make migrate          # Generate schema + run migrations
make generate         # Regenerate schema.prisma from slices
make studio           # Open Prisma Studio

# Build & Test
make build            # Build all services
make lint             # Lint all services
make test             # Run tests
make clean            # Remove node_modules and build artifacts
```

### Services & Endpoints

After `ranch dev` (or `make dev`):

| URL | Description |
|---|---|
| `http://localhost:3000` | API (NestJS) |
| `http://localhost:3000/api` | Swagger UI — full endpoint reference |
| `http://localhost:3000/mcp/*` | MCP runtime (tools exposed via `@Tool` decorators) |
| `http://localhost:3000/health` | Health check |
| `http://localhost:3001` | App (user dashboard) |
| `http://localhost:3002` | Admin panel |

`ranch dev` also brings up a local **k3d** cluster (`ranch`) with the
`platform` and `agents` namespaces and Argo workflow templates pre-applied,
so the API can submit real agent workflows against a local Kubernetes.
Kubeconfig is written to `~/.kube/ranch-local.yaml`.

### Optional: LightRAG stack

For RAG-backed agents, a LightRAG + Ollama + Postgres stack ships behind a
Docker Compose profile:

```bash
make lightrag-up      # First run pulls ~3GB of models — LightRAG at :9621
make lightrag-down    # Stop (keeps data)
make lightrag-reset   # Wipe data + models
make lightrag-logs    # Tail container logs
```

## Prisma Schema (per-slice)

Each slice defines its own `.prisma` file at the slice root. They are merged into `prisma/schema.prisma` by `prisma-import` at build time.

```
api/src/slices/
├── setup/prisma/prisma.prisma          # datasource + generator
├── agent/agent/agent.prisma            # Agent model
├── agent/template/template.prisma      # Template model
└── user/user/user.prisma               # User model
```

Edit the slice `.prisma` files, then:

```bash
make generate   # Merge into prisma/schema.prisma
make migrate    # Create migration + generate client
```

## Deploy to Hetzner Cloud

> 📘 Full Terraform guide (remote state backend, environments, imports, DNS, gotchas):
> [`terraform/README.md`](terraform/README.md)

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

# Apply workflow templates
kubectl apply -f k8s/templates/agent-workflow.yaml
```

### 6. Configure DNS

Add A records at your DNS provider pointing to the Load Balancer IP:

```
api.ranch.yourdomain.com      A  → <LB_IP>
app.ranch.yourdomain.com      A  → <LB_IP>
admin.ranch.yourdomain.com    A  → <LB_IP>
argocd.ranch.yourdomain.com   A  → <LB_IP>
```

Get the LB IP:

```bash
kubectl get svc -n traefik traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
```

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

## License

Private — CleanSlice
