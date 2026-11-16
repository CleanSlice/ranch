# Architecture

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
│       ├── agent/        #   agent, file, pod, secret, template, templateFile, peer
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
│   └── slices/           #   setup, agent, bridle, share, template, user, common
├── admin/                # Nuxt admin panel
│   └── slices/           #   setup, agent (incl. peer), bridle, llm, mcpServer,
│                         #   rancher,
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
