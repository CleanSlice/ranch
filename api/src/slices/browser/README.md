# browser slice

Shared browser-pool sessions for the runtime's `browser_play` tool. Solves
three concrete problems we hit on Instagram automation:

1. **Persistent logins across pod restarts** — cookies live on a PVC
   namespaced by `(userId, accountKey)`, never on the runtime pod.
2. **2FA / CAPTCHA flows** — when a profile loses its session, the API
   mints a 15-min VNC URL; the user opens it in their browser, logs in
   by hand, and the agent picks up where it left off.
3. **Stuck sessions** — when `browser_play` times out at 120s, the
   admin UI's "Reset" button drops the browser process and returns a
   fresh CDP URL on the same profile (no need to re-login).

## Wire diagram

```
┌─────────────────┐  /browser/sessions     ┌──────────────┐
│  admin UI (Nuxt)│ ◄────────────────────► │              │
└─────────────────┘    JWT auth            │              │
                                           │  ranch-api   │
┌─────────────────┐  /browser/internal/*   │  (this slice)│
│  runtime pod    │ ◄────────────────────► │              │
└────────┬────────┘    x-bridle-api-key    └──────┬───────┘
         │                                        │
         │ CDP WebSocket                          │  Postgres
         │ ws://browser-pool:3000?token=...       │  (BrowserSession)
         ▼                                        │
┌──────────────────────────────────────────┐      │
│  browser-pool (StatefulSet)              │      │
│  ─ headless Chromium per CDP connect     │      │
│  ─ profiles on PVC: /profiles/<u>/<a>/   │      │
│  ─ noVNC live view on the same port      │      │
└──────────────────────────────────────────┘      │
       ▲                                          │
       │  https://browser.ranch.cleanslice.org    │
       │  (signed JWT scoped per session)         │
       │                                          │
┌──────┴────────┐                                 │
│  end user     │ ◄───────────────────────────────┘
│  (does 2FA)   │   Telegram: "open <vncUrl>"
└───────────────┘
```

## Files

```
browser.prisma                       BrowserSession model
browser.module.ts
browser.controller.ts                /browser/sessions (JWT-guarded)
browser.internal.controller.ts       /browser/internal/sessions (bridle-key-guarded)
browser.tool.ts                      MCP @Tool wrappers
domain/
  browser.gateway.ts                 IBrowserGateway (DI token)
  browser.types.ts                   IBrowserSessionData, status enum
data/
  browser.gateway.ts                 Prisma + URL minting
  browser.mapper.ts
  browserless.client.ts              CDP / VNC URL construction
dtos/
  openSession.dto.ts
  sessionResponse.dto.ts
  setStatus.dto.ts
```

## Deploy checklist

```
# 1. Generate the pool token and add it to tfvars (gitignored — never commit).
echo "browser_pool_token = \"$(openssl rand -hex 32)\"" \
  >> terraform/environments/dreamvention/terraform.tfvars

# 2. Apply terraform — recreates ranch-secrets with BROWSER_POOL_TOKEN added.
cd terraform/environments/dreamvention && terraform apply

# 3. Apply the new k8s manifests + the updated ranch-api Deployment.
kubectl apply -f k8s/deploy/30-api.yaml
kubectl apply -f k8s/deploy/50-browser-pool.yaml
kubectl apply -f k8s/deploy/51-browser-pool-cleanup.yaml

# 4. Run prisma migrations — the API initContainer does this automatically
#    on pod start, but in dev you'll want to bump it manually:
cd api && bunx prisma migrate dev --name add-browser-session

# 5. Regenerate the admin SDK from swagger so BrowserService exists:
cd admin && bun run gen:api

# 6. Bump runtime image — playwright.repository.ts now talks the
#    browserless Playwright protocol to the pool.
docker build runtime/ -t ghcr.io/cleanslice/runtime:0.10.0 && docker push ...
```

The pool token lives in `ranch-secrets` (key `BROWSER_POOL_TOKEN`), provisioned
by `terraform/modules/apps/main.tf`. It is **never** in a k8s manifest under
`k8s/deploy/` — those YAMLs only reference the Secret by name. To rotate, edit
`terraform.tfvars` and re-apply terraform; then restart both pods so they pick
up the new value:

```
kubectl -n platform rollout restart \
  statefulset/browser-pool deployment/ranch-api
```

## Skill prompt fragment

Drop this into any skill that uses `browser_play` (instagram-ads, paid-ads,
integrations, etc.) so agents know how to handle the new login flow:

```md
## Browser sessions

`browser_play` runs in a shared browser pool. Each profile is logged in
once and the cookies persist across calls. When a profile loses its login:

1. `browser_play` returns `{ needsLogin: true, vncUrl, sessionId }`.
2. Forward `vncUrl` to the user verbatim: "Open this link, log in, then
   tell me when you're done: <vncUrl>". The URL is valid for 15 minutes.
3. Wait for the user to confirm. Do NOT retry `browser_play` until they
   say they've logged in.
4. After confirmation, retry the original `browser_play` call as-is.

If `browser_play` returns `ok: false` with an error and a `vncUrl`,
something more serious is wrong — share the error with the user and
let them decide whether to log in again or reset the session.
```

## Trust boundaries

- `/browser/sessions/*` is gated by `JwtAuthGuard` — only the user who
  owns a session can act on it. `findById` and `requireOwned` both
  filter by `userId` from the JWT.
- `/browser/internal/sessions/*` is gated by `BridleApiKeyGuard` — the
  runtime forwards `ctx.from` as `userId`. Anyone holding the bridle key
  can claim any userId (same trust model as `secret_*` tools).
- Profile paths are built only inside `BrowserlessClient.profilePath()`
  — the only place that joins `userId` and `accountKey` into a
  filesystem path. `accountKey` is validated against
  `^[a-zA-Z0-9_:\-]+$` in the DTO before it reaches the gateway.
- The CDP URL embeds the pool token and launch args — never expose to
  the agent or the UI. The VNC URL embeds a session-scoped 15-min JWT
  and is safe to show in the admin and forward to the user.
