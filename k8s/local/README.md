# Local Kubernetes for Ranch

Brings up a local k3d cluster with Argo Workflows so the backend can deploy agents as real pods.

## Prerequisites

- Docker (running)
- `k3d`, `kubectl`, `helm` on PATH

```bash
brew install k3d helm        # kubectl ships with Docker Desktop
```

## Bring up

```bash
cd ranch/k8s/local
./up.sh
```

This will:

1. Create a k3d cluster named `ranch-local` (single node, no traefik).
2. Install Argo Workflows into the `argo` namespace via Helm.
3. Apply `agents` namespace + RBAC + the `agent-deployment` WorkflowTemplate.
4. Background a `kubectl port-forward` so `http://localhost:2746` talks to argo-server.

Then in `ranch/api/.env.dev` set:

```env
WORKFLOW_PROVIDER=argo
ARGO_WORKFLOWS_URL=http://localhost:2746
```

Restart the api (nest watch picks up .ts changes; .env needs a full restart).

## Tear down

```bash
./down.sh
```

Removes the port-forward and deletes the cluster.

## Verify manually

Submit a workflow through the API:

```bash
TPL=$(curl -s http://localhost:3333/templates | jq -r '.data[0].id')
curl -X POST http://localhost:3333/agents \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"smoke\",\"templateId\":\"$TPL\"}"
```

Watch it land in the cluster:

```bash
kubectl -n agents get workflows -w
kubectl -n agents get pods -w
```

Open Argo UI at `http://localhost:2746`.

## Private registry (GitHub Container Registry)

If your template image is private (e.g. `ghcr.io/...`), pods will hit `ImagePullBackOff`. Fix:

1. In admin UI → **Settings** → fill:
   - `integrations/github_username`
   - `integrations/github_pat` (a Personal Access Token with `read:packages` scope)
   - **Save**
2. Run:
   ```bash
   ./sync-registry-secret.sh
   ```
   This reads both settings from the API, creates a `docker-registry` secret `ghcr` in the `agents` namespace, and patches the default ServiceAccount to use it.
3. Recreate any stuck agents (delete + create, or just delete their pods — the Argo workflow will retry).

Needs `jq`, `kubectl`, `curl` on PATH.

## Notes

- The WorkflowTemplate uses the `workflow` ServiceAccount in `agents` ns which has permission to create pods and sub-workflows.
- Argo server runs with `--auth-mode=server` so HTTP calls without a token are accepted (OK for local only).
- The image comes from the Template row in the DB — the backend looks it up on create and passes it to the workflow.
- The port-forward to argo-server is wrapped in an auto-reconnect loop (`ranch-argo-pf-loop`) — if argo-server restarts, the forward is re-established within ~2 s.
- Switch back to the in-memory stub with `WORKFLOW_PROVIDER=mock` if you don't want the cluster running.
