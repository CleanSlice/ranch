# Ranch - Agent Deployment Platform

## Overview

Platform for deploying and managing AI agents on Kubernetes (Hetzner Cloud).
Includes infrastructure-as-code, GitOps delivery, and a management UI.

## Technology Stack (Fixed - CleanSlice)

- **api/** - NestJS + Prisma (backend)
- **app/** - Nuxt + Vue 3 + Pinia + Tailwind + shadcn-vue (user-facing dashboard)
- **admin/** - Nuxt + Vue 3 + Pinia + Tailwind + shadcn-vue (admin panel)
- **terraform/** - Hetzner Cloud infrastructure (k3s, DB, network, ArgoCD)
- **k8s/** - Kubernetes manifests (ArgoCD syncs from here)
- **Runtime:** Bun
- **Monorepo:** Turborepo

---

## Phase 1: High-Level Plan

### Apps

| App | Purpose |
|-----|---------|
| **api** | REST API for agent lifecycle management. Submits Argo Workflows, tracks agent status, streams logs |
| **app** | User dashboard: create agents, view status, logs, metrics |
| **admin** | Admin panel: manage templates, view all agents, system settings, user management |

### API Slices

| Slice | Type | Responsibility |
|-------|------|---------------|
| `setup/prisma` | setup | Database client (PrismaService) |
| `setup/health` | setup | Health check endpoint |
| `setup/error` | setup | Error handling interceptor |
| `agent` | feature | CRUD agents, trigger deployments, status tracking |
| `workflow` | feature | Argo Workflows integration (submit, cancel, status) |
| `template` | feature | Agent templates management (Docker images, configs, resource defaults) |
| `log` | feature | Agent log retrieval and streaming |

### App Slices (User Dashboard)

| Slice | Type | Responsibility |
|-------|------|---------------|
| `setup/pinia` | setup | State management |
| `setup/i18n` | setup | Internationalization |
| `setup/theme` | setup | Tailwind + shadcn-vue |
| `setup/error` | setup | Error handling + toasts |
| `setup/api` | setup | hey-api SDK generation |
| `agent` | feature | Agent list, detail, create, logs pages |
| `template` | feature | Browse and select agent templates |
| `common` | feature | Shared layouts, navigation |

### Admin Slices

| Slice | Type | Responsibility |
|-------|------|---------------|
| `setup/pinia` | setup | State management |
| `setup/i18n` | setup | Internationalization |
| `setup/theme` | setup | Tailwind + shadcn-vue |
| `setup/error` | setup | Error handling + toasts |
| `setup/api` | setup | hey-api SDK generation |
| `agent` | feature | All agents overview, manage any agent |
| `template` | feature | CRUD agent templates |
| `user` | feature | User management |
| `setting` | feature | System settings, resource quotas |
| `common` | feature | Admin layouts, navigation |

### Terraform Modules

| Module | Purpose |
|--------|---------|
| `network` | Hetzner VPC, Firewall rules |
| `cluster` | k3s via kube-hetzner (control plane + node pools) |
| `database` | Hetzner Managed PostgreSQL |
| `dns` | DNS records |
| `bootstrap` | ArgoCD + Argo Workflows Helm releases |

### K8s Manifests

| Directory | Purpose |
|-----------|---------|
| `argocd/` | App-of-apps, ArgoCD projects |
| `platform/api/` | API Deployment, Service, Ingress, HPA |
| `platform/app/` | App Deployment, Service, Ingress |
| `platform/admin/` | Admin Deployment, Service, Ingress |
| `platform/monitoring/` | Prometheus, Grafana |
| `templates/` | Argo Workflow templates for agent pods |

---

## Project Structure

```
ranch/
├── api/                            # NestJS
│   ├── src/
│   │   ├── slices/
│   │   │   ├── setup/
│   │   │   │   ├── prisma/
│   │   │   │   ├── health/
│   │   │   │   └── error/
│   │   │   ├── agent/
│   │   │   ├── workflow/
│   │   │   ├── template/
│   │   │   └── log/
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/
│   ├── Dockerfile
│   └── package.json
├── app/                            # Nuxt (user dashboard)
│   ├── slices/
│   │   ├── setup/
│   │   ├── agent/
│   │   ├── template/
│   │   └── common/
│   ├── nuxt.config.ts
│   ├── registerSlices.ts
│   ├── Dockerfile
│   └── package.json
├── admin/                          # Nuxt (admin panel)
│   ├── slices/
│   │   ├── setup/
│   │   ├── agent/
│   │   ├── template/
│   │   ├── user/
│   │   ├── setting/
│   │   └── common/
│   ├── nuxt.config.ts
│   ├── registerSlices.ts
│   ├── Dockerfile
│   └── package.json
├── terraform/
│   ├── modules/
│   │   ├── cluster/
│   │   ├── database/
│   │   ├── network/
│   │   ├── dns/
│   │   └── bootstrap/
│   ├── environments/
│   │   ├── dev/
│   │   └── prod/
│   └── backend.tf
├── k8s/
│   ├── argocd/
│   ├── platform/
│   │   ├── api/
│   │   ├── app/
│   │   ├── admin/
│   │   └── monitoring/
│   └── templates/
├── .github/
│   └── workflows/
│       ├── ci.yaml
│       ├── build-images.yaml
│       └── terraform.yaml
├── turbo.json
├── package.json
├── bun.lock
└── PLAN.md
```

---

## Awaiting Approval

Please review this plan. Once approved, I will proceed with detailed implementation.
