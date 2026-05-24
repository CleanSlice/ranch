// JWT-gated noVNC bridge.
//
// Two responsibilities:
//   - GET /live?id=<sid>&token=<jwt>      → verify JWT, redirect into noVNC
//   - WS  /websockify?token=<jwt>          → verify JWT, proxy to local websockify
//
// JWT contract (signed by ranch-api with HS256 / JWT_SECRET):
//   { sub: <userId>, sid: <sessionId>, scope: 'browser:vnc', iat, exp }
//
// We don't enforce sid ↔ Chrome-window mapping here: the upstream browserless
// pod runs a single shared Xvfb, so every session in the pool renders to the
// same display. Per-session viewport isolation needs a per-session Xvfb, which
// is a bigger refactor — for now any holder of a valid JWT sees the full
// display. Documented in README.

import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import crypto from 'node:crypto'

const PORT = parseInt(process.env.AUTH_PROXY_PORT ?? '7900', 10)
const WEBSOCKIFY_PORT = parseInt(process.env.WEBSOCKIFY_PORT ?? '6080', 10)
const NOVNC_DIR = process.env.NOVNC_DIR ?? '/usr/share/novnc'
const SECRET = process.env.JWT_SECRET

if (!SECRET) {
  console.error('[auth-proxy] JWT_SECRET is required — pool URLs cannot be verified without it')
  process.exit(1)
}

function b64urlDecode(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/')
  while (t.length % 4) t += '='
  return Buffer.from(t, 'base64')
}

function verifyJwt(token) {
  if (typeof token !== 'string' || token.length > 4096) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerB64, payloadB64, sigB64] = parts
  let header
  try { header = JSON.parse(b64urlDecode(headerB64).toString()) } catch { return null }
  if (header.alg !== 'HS256') return null
  const expected = crypto.createHmac('sha256', SECRET).update(`${headerB64}.${payloadB64}`).digest()
  const provided = b64urlDecode(sigB64)
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null
  let payload
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString()) } catch { return null }
  if (payload.scope !== 'browser:vnc') return null
  if (typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) return null
  return payload
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
}

function serveStatic(req, res, root, rel) {
  // Prevent path traversal — keep the resolved path inside `root`.
  const safe = normalize('/' + rel).replace(/^\/+/, '')
  const fp = join(root, safe)
  if (!fp.startsWith(root)) { res.writeHead(403).end(); return }
  try {
    const st = statSync(fp)
    if (!st.isFile()) { res.writeHead(404).end(); return }
    res.writeHead(200, {
      'content-type': MIME[extname(fp).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
    })
    createReadStream(fp).pipe(res)
  } catch {
    res.writeHead(404).end()
  }
}

const server = createServer((req, res) => {
  let url
  try { url = new URL(req.url, 'http://x') } catch { res.writeHead(400).end(); return }
  const path = url.pathname

  if (path === '/live') {
    const token = url.searchParams.get('token')
    const sid = url.searchParams.get('id')
    const payload = token && verifyJwt(token)
    if (!payload || (sid && payload.sid !== sid)) {
      res.writeHead(401, { 'content-type': 'text/plain' })
      return res.end('Unauthorized — link expired or invalid. Ask the agent to mint a new one.')
    }
    // Hand off to noVNC's bundled vnc.html with autoconnect. The path param
    // tells noVNC where to open the WebSocket; we forward the same token
    // so the upgrade hits verifyJwt() again.
    const wsPath = `websockify?token=${encodeURIComponent(token)}`
    const target = `/vnc/vnc.html?autoconnect=1&resize=scale&path=${encodeURIComponent(wsPath)}`
    res.writeHead(302, { location: target })
    return res.end()
  }

  if (path === '/vnc' || path === '/vnc/') {
    res.writeHead(302, { location: '/vnc/vnc.html' })
    return res.end()
  }

  if (path.startsWith('/vnc/')) {
    return serveStatic(req, res, NOVNC_DIR, path.slice('/vnc/'.length))
  }

  if (path === '/healthz') {
    res.writeHead(200).end('ok')
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
})

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  let url
  try { url = new URL(req.url, 'http://x') } catch { socket.destroy(); return }
  if (url.pathname !== '/websockify') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return
  }
  const token = url.searchParams.get('token')
  if (!token || !verifyJwt(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
  }

  // Negotiate the binary subprotocol noVNC expects, then bridge frames
  // verbatim between the user's browser and the local websockify.
  wss.handleUpgrade(req, socket, head, (client) => {
    const upstream = new WebSocket(`ws://127.0.0.1:${WEBSOCKIFY_PORT}/`, ['binary'])

    const cleanup = () => {
      try { client.close() } catch {}
      try { upstream.close() } catch {}
    }

    upstream.on('open', () => {
      client.on('message', (data, isBinary) => upstream.send(data, { binary: isBinary }))
      upstream.on('message', (data, isBinary) => client.send(data, { binary: isBinary }))
      client.on('close', cleanup)
      upstream.on('close', cleanup)
      client.on('error', cleanup)
      upstream.on('error', cleanup)
    })
    upstream.on('error', (err) => {
      console.error('[auth-proxy] upstream ws error:', err.message)
      cleanup()
    })
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[auth-proxy] listening on :${PORT}, novnc dir ${NOVNC_DIR}, upstream :${WEBSOCKIFY_PORT}`)
})
