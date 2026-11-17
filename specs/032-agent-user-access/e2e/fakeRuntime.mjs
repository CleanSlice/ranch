// A stand-in for the agent runtime, for the acting-party checks (CLEAN-232).
// Like specs/030-agent-request-limits/e2e/fakeAgent.mjs, with one difference
// that is the point: it keeps the WHOLE message the hub sent, so a check can
// read `acting` (the token the API minted for the person who wrote it) and
// then call tools exactly as a runtime would.
//
//   node specs/032-agent-user-access/e2e/fakeRuntime.mjs
//
// It connects for the Ranch admin agent and the three ordinary agents and
// answers every message with a short echo.
//
// Control port (FAKE_RUNTIME_PORT, default 3397), bound to 127.0.0.1:
//   GET  /health
//   GET  /received?agentId=…     whole inbound messages, oldest first
//   POST /reset                  forget what was received
//   POST /disconnect?agentId=…   drop that agent's socket (a real runtime
//                                takes its place in assistant.mjs)
//   POST /connect?agentId=…      connect it again
//
// Acting tokens live in this process's memory only and leave it only through
// /received on loopback. Nothing here writes a token, or the bridle key it
// reads from api/.env, to disk or to stdout.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AGENTS, API, apiEnv, requireFromApi } from './lib.mjs';

const { io } = requireFromApi('socket.io-client');
const PORT = Number(process.env.FAKE_RUNTIME_PORT || 3397);

if (!apiEnv.BRIDLE_API_KEY) {
  console.error('BRIDLE_API_KEY is missing in api/.env');
  process.exit(1);
}

const IDS = Object.values(AGENTS).map((a) => a.id);
/** agentId → whole messages */
const received = new Map(IDS.map((id) => [id, []]));
/** agentId → socket */
const sockets = new Map();

function connect(agentId) {
  if (sockets.has(agentId)) return sockets.get(agentId);
  const socket = io(`${API}/ws/agent`, {
    auth: { apiKey: apiEnv.BRIDLE_API_KEY, agentId },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
  });
  socket.on('connect', () => console.log(`  ${agentId} connected`));
  socket.on('disconnect', (reason) => console.log(`  ${agentId} disconnected (${reason})`));
  socket.on('connect_error', (err) => console.log(`  ${agentId} cannot connect: ${err.message}`));
  socket.on('message', (msg) => {
    // The whole message, as it came. Never logged: it carries `acting.token`.
    received.get(agentId).push({ ...(msg ?? {}), at: Date.now() });
    socket.emit('message', {
      type: 'message',
      clientId: msg?.clientId,
      text: `echo: ${msg?.text ?? ''}`,
      messageId: randomUUID(),
      ts: Date.now(),
    });
  });
  // The hub asks a runtime to push its files before some operations; a
  // fixture has none, so it says so at once.
  socket.on('sync', (msg) => socket.emit('sync_done', { requestId: msg?.requestId, pushed: 0 }));
  sockets.set(agentId, socket);
  return socket;
}

function disconnect(agentId) {
  const socket = sockets.get(agentId);
  if (!socket) return false;
  socket.disconnect();
  sockets.delete(agentId);
  return true;
}

for (const id of IDS) connect(id);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const agentId = url.searchParams.get('agentId');
  if (url.pathname === '/health') {
    return json({
      ok: true,
      agents: IDS.length,
      connected: [...sockets.entries()].filter(([, s]) => s.connected).map(([id]) => id),
    });
  }
  if (url.pathname === '/received') return json(received.get(agentId) ?? []);
  if (url.pathname === '/reset' && req.method === 'POST') {
    for (const list of received.values()) list.length = 0;
    return json({ ok: true });
  }
  if (url.pathname === '/disconnect' && req.method === 'POST') {
    return json({ ok: true, wasConnected: disconnect(agentId) });
  }
  if (url.pathname === '/connect' && req.method === 'POST') {
    if (!IDS.includes(agentId)) return json({ error: 'not a fixture agent' }, 404);
    connect(agentId);
    return json({ ok: true });
  }
  return json({ error: 'not found' }, 404);
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake runtimes on ${API}, control on 127.0.0.1:${PORT}`));
