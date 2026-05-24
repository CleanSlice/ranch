# browser-pool image

Custom Chromium pool image for the ranch platform. Adds JWT-gated noVNC
live takeover on top of `ghcr.io/browserless/chromium`.

## What this fixes

The upstream browserless image:

1. Starts `Xvfb :99 -nolisten tcp -nolisten unix`, so no sidecar can attach
   x11vnc to the display.
2. Exposes no `/live` route — `ENABLE_LIVE=true` is a no-op in the open-source
   build (the live view is a Browserless Cloud feature only).

Ranch-api mints VNC URLs at `/live?id=<sessionId>&token=<JWT>`. Without this
image, those URLs return `404 No route or file found for resource GET: /live`
straight from browserless's Fastify 404.

## Layout

| File             | Role                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `Dockerfile`     | Layers x11vnc, websockify, novnc, and the auth-proxy on browserless.  |
| `start.sh`       | Overrides browserless's entrypoint — Xvfb without `-nolisten`, then x11vnc + websockify + auth-proxy + browserless. |
| `auth-proxy.mjs` | Node service on :7900. Verifies the ranch-api JWT on `/live` and `/websockify`, serves noVNC static from `/usr/share/novnc`. |
| `package.json`   | Single dep: `ws` (WebSocket bridge between browser and websockify).   |

## Request flow

```
Telegram link → https://browser.ranch.cleanslice.org/live?id=<sid>&token=<JWT>
                       │
                       ▼ Ingress: /live → service port 7900
                  auth-proxy verifies JWT (HS256 / JWT_SECRET, scope=browser:vnc)
                       │ 302
                       ▼
                  /vnc/vnc.html?autoconnect=1&path=websockify?token=<JWT>
                       │
                       ▼ noVNC opens WS to /websockify?token=<JWT>
                  auth-proxy verifies again → bridges to ws://127.0.0.1:6080
                       │
                       ▼
                  websockify → x11vnc → Xvfb :99 → Chromium
```

CDP traffic from runtime agents is unaffected — `/chromium`, `/json/*`,
`/sessions`, and the rest still go to browserless on port 3000.

## Tenancy

All sessions on a pod share one Xvfb display, so a valid VNC JWT sees every
active Chrome window in that pod. Fine for the current effectively
single-tenant deployment; if the pool ever serves untrusted users
concurrently, per-session Xvfb (or a different image entirely) is required.

## Build & push

```sh
docker buildx build \
  --platform linux/amd64 \
  -t ghcr.io/cleanslice/browser-pool:latest \
  --push \
  ranch/k8s/browser-pool-image
```

The k8s manifest (`ranch/k8s/deploy/50-browser-pool.yaml`) already points
at `ghcr.io/cleanslice/browser-pool:latest` with `imagePullPolicy: Always`,
so a rolling pod restart picks up the new image:

```sh
KUBECONFIG=~/.kube/ranch-dreamvention \
  kubectl -n platform rollout restart statefulset/browser-pool
```

Smoke-test from your workstation once the pod is Ready:

```sh
# 1. Cause the agent to mint a VNC URL (e.g. trigger a 2FA flow in chat).
# 2. Open the link — you should see the Chrome window inside noVNC.
# 3. If you get 401, JWT_SECRET in ranch-secrets has drifted from the one
#    the API container reads. Both must match.
```

## Local iteration without pushing

```sh
docker build -t browser-pool:dev ranch/k8s/browser-pool-image
docker run --rm -p 3000:3000 -p 7900:7900 \
  -e TOKEN=devtoken \
  -e JWT_SECRET=dev-secret-change-me \
  browser-pool:dev
```

Then hit `http://localhost:7900/live?id=test&token=<a JWT you sign with the
same secret>`. The dev JWT_SECRET above matches ranch-api's `.env` default,
so a token minted by a local API will verify against this container.
