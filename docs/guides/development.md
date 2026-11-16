# Development

## Prerequisites

- [Bun](https://bun.sh/) — `curl -fsSL https://bun.sh/install | bash`
- [Docker](https://docs.docker.com/get-docker/) — for local PostgreSQL
- [Terraform](https://developer.hashicorp.com/terraform/install) — for infrastructure
- [kubectl](https://kubernetes.io/docs/tasks/tools/) — for cluster management
- [Helm](https://helm.sh/docs/intro/install/) — for chart management

## Local Development

### Recommended: `ranch` CLI

The `ranch` CLI wraps the most-used `make` targets and works from any
directory once installed globally. See [`cli/README.md`](../../cli/README.md)
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

### The LightRAG stack

For RAG-backed agents, a LightRAG + Ollama + Postgres stack ships behind the
`rag` Docker Compose profile. `ranch dev` turns that profile on by itself, so
the stack is up whenever the cluster is — but it only starts the containers.
The Ollama models are pulled lazily, on the first request that needs one.
`make lightrag-up` pulls them up front instead, and `ranch dev --no-k3d`
leaves the cluster and this stack out altogether:

```bash
make lightrag-up      # Pulls llama3.2 + nomic-embed-text, ~3GB — LightRAG at :9621
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

## Translations (`app` console)

The user console ships in English and Russian. `en.json` in each slice is the
source; `bun run i18n:sync` generates the translation, and `bun run i18n:check`
(a CI step) fails on a missing, stale or undefined key. The admin panel is
English-only by design.

See [`docs/i18n.md`](../../docs/i18n.md) before adding a user-visible string.
