// A stand-in for the agent runtime, for the request-limit browser checks
// (CLEAN-224). It connects to the hub for each seeded agent exactly as a
// runtime does (`/ws/agent`, the bridle key, the agent id) and answers every
// message with a short text — so the checks need no model, no pod and no
// network, and "the fourth message never reached the agent" is something a
// test can actually read.
//
//   node specs/030-agent-request-limits/e2e/fakeAgent.mjs
//
// A small control port (FAKE_AGENT_PORT, default 3398):
//   GET  /health
//   GET  /received?agentId=…   what that agent was sent, oldest first
//   POST /reset                forget what was received, answer at once again
//   POST /delay?ms=…           wait before each answer (keeps a turn open)
//
// Reads BRIDLE_API_KEY from api/.env; never prints it.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AGENTS, apiEnv, requireFromApi } from './lib.mjs';
import { API } from '../../026-app-console-redesign/e2e/lib.mjs';

const { io } = requireFromApi('socket.io-client');
const PORT = Number(process.env.FAKE_AGENT_PORT || 3398);

if (!apiEnv.BRIDLE_API_KEY) {
  console.error('BRIDLE_API_KEY is missing in api/.env');
  process.exit(1);
}

/** agentId → [{ clientId, text, at }] */
const received = new Map();
let delayMs = 0;

function connect(agentId) {
  received.set(agentId, []);
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
    const { clientId, text } = msg ?? {};
    received.get(agentId).push({ clientId, text, at: Date.now() });
    const answer = () =>
      socket.emit('message', {
        type: 'message',
        clientId,
        text: `echo: ${text}`,
        messageId: randomUUID(),
        ts: Date.now(),
      });
    if (delayMs > 0) setTimeout(answer, delayMs);
    else answer();
  });
  // The hub asks a runtime to push its files before some operations; a
  // fixture has none, so it says so at once.
  socket.on('sync', (msg) => socket.emit('sync_done', { requestId: msg?.requestId, pushed: 0 }));
  return socket;
}

const sockets = Object.values(AGENTS).map(connect);

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (body, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/health') return json({ ok: true, connected: sockets.filter((s) => s.connected).length });
  if (url.pathname === '/received') return json(received.get(url.searchParams.get('agentId')) ?? []);
  if (url.pathname === '/reset' && req.method === 'POST') {
    for (const list of received.values()) list.length = 0;
    delayMs = 0;
    return json({ ok: true });
  }
  if (url.pathname === '/delay' && req.method === 'POST') {
    delayMs = Math.max(0, Number(url.searchParams.get('ms')) || 0);
    return json({ ok: true, delayMs });
  }
  return json({ error: 'not found' }, 404);
});
server.listen(PORT, () => console.log(`fake agents on ${API}, control on :${PORT}`));
