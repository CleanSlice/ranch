#!/usr/bin/env bun
//
// Verify the VNC stack end-to-end without depending on the agent runtime.
//
// What this script does:
//   1. Reads BROWSER_POOL_TOKEN + JWT_SECRET from ranch-secrets via kubectl.
//   2. Opens a CDP WebSocket to the pool — that launches a real Chrome on
//      Xvfb :99 inside the browser-pool pod.
//   3. Tells Chrome to navigate to example.com (so the display isn't blank).
//   4. Mints a fresh /live VNC URL signed with the same JWT_SECRET ranch-api
//      uses, prints it, and keeps the CDP socket open for 15 minutes.
//
// Two modes:
//   - prod (default):  reads secrets from `kubectl get secret ranch-secrets`,
//                      hits browser.ranch.cleanslice.org over wss/https.
//   - local:            BROWSER_POOL_LOCAL=1 — uses BROWSER_POOL_TOKEN +
//                      JWT_SECRET from env, hits localhost:13000 (CDP) and
//                      localhost:17900 (auth-proxy). Run after
//                      `docker compose up -d browserless` in ranch/api.
//
// Run:
//   bun run ranch/k8s/browser-pool-image/verify-vnc.mjs                # prod
//   BROWSER_POOL_LOCAL=1 \
//   BROWSER_POOL_TOKEN=dev-browser-pool-token-change-me \
//   JWT_SECRET=dev-secret-change-me \
//     bun run ranch/k8s/browser-pool-image/verify-vnc.mjs              # local
//
// Then open the printed URL in your browser. You should see example.com
// inside noVNC, NOT a black screen. Ctrl-C to release the session.
//
// If you see example.com, the whole noVNC / x11vnc / websockify / auth-proxy
// chain is healthy — the production black screen is purely the runtime not
// holding a CDP connection during browser_login, which is the human-tasks
// refactor.

import crypto from "node:crypto"
import { execSync } from "node:child_process"

const LOCAL = process.env.BROWSER_POOL_LOCAL === "1"
const KUBECONFIG = process.env.KUBECONFIG ?? `${process.env.HOME}/.kube/ranch-dreamvention`

// Two profiles: prod hits the public ingress over TLS; local hits the
// host-mapped ports from docker-compose with no TLS.
const VNC_HOST = process.env.BROWSER_POOL_VNC_HOST ?? (LOCAL ? "localhost:17900" : "browser.ranch.cleanslice.org")
const CDP_HOST = process.env.BROWSER_POOL_CDP_HOST ?? (LOCAL ? "localhost:13000" : "browser.ranch.cleanslice.org")
const SCHEME_HTTP = LOCAL ? "http" : "https"
const SCHEME_WS = LOCAL ? "ws" : "wss"

function readSecret(key) {
  if (process.env[key]) return process.env[key]
  const cmd = `KUBECONFIG=${KUBECONFIG} kubectl -n platform get secret ranch-secrets -o jsonpath='{.data.${key}}' | base64 -d`
  return execSync(cmd, { shell: "/bin/bash" }).toString().trim()
}

const POOL_TOKEN = readSecret("BROWSER_POOL_TOKEN")
const JWT_SECRET = readSecret("JWT_SECRET")
if (!POOL_TOKEN || !JWT_SECRET) {
  console.error("Could not resolve BROWSER_POOL_TOKEN / JWT_SECRET (env or kubectl)")
  process.exit(1)
}

const launch = {
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  headless: false,
  stealth: true,
}
const cdpUrl = `${SCHEME_WS}://${CDP_HOST}/chromium?token=${POOL_TOKEN}&launch=${encodeURIComponent(JSON.stringify(launch))}`

const SID = "verify-" + crypto.randomBytes(4).toString("hex")
const USER = "verify-user"

const b64 = (s) => Buffer.from(s).toString("base64url")
const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))
const payload = b64(JSON.stringify({
  sub: USER,
  sid: SID,
  scope: "browser:vnc",
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 15 * 60,
}))
const sig = b64(crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest())
const token = `${header}.${payload}.${sig}`
const vncUrl = `${SCHEME_HTTP}://${VNC_HOST}/live?id=${encodeURIComponent(SID)}&token=${encodeURIComponent(token)}`

console.log("[verify] connecting to pool CDP via wss…")
const ws = new WebSocket(cdpUrl) // bun provides WebSocket as a global

let cdpId = 0
const send = (method, params = {}) => {
  cdpId += 1
  ws.send(JSON.stringify({ id: cdpId, method, params }))
}

ws.addEventListener("open", () => {
  console.log("[verify] CDP open — Chrome is now running on Xvfb :99")
  send("Target.createTarget", { url: "https://example.com" })

  console.log("\n=========================== OPEN IN BROWSER ===========================")
  console.log(vncUrl)
  console.log("=======================================================================\n")
  console.log("[verify] keeping the session alive for 15 minutes. Ctrl-C to release.")
})

ws.addEventListener("message", (ev) => {
  // Surface only the CDP responses to our own commands. Browserless emits
  // a flood of target/page events; we don't care about them for this test.
  try {
    const msg = JSON.parse(ev.data)
    if (msg.id && msg.id <= cdpId) {
      console.log(`[verify] cdp #${msg.id} ok`)
    }
  } catch { /* binary frame, ignore */ }
})

ws.addEventListener("error", (e) => {
  console.error("[verify] ws error:", e.message ?? e)
  process.exit(1)
})

ws.addEventListener("close", (ev) => {
  console.log(`[verify] CDP closed (code=${ev.code}). Chrome on the pool will be torn down by browserless.`)
  process.exit(0)
})

setTimeout(() => {
  console.log("[verify] 15 min elapsed, releasing session")
  ws.close()
}, 15 * 60 * 1000)

process.on("SIGINT", () => { console.log("\n[verify] Ctrl-C — releasing"); ws.close() })
