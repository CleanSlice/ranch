// Probe the local bridle hub the way the browser does. Prints no secrets.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const REPO = 'C:/Users/maxim/orca/workspaces/ranch/chat-issues';
const require = createRequire(REPO + '/package.json');
const { io } = require('socket.io-client');

const API = 'http://localhost:3333';
const AGENT = 'agent-bb620efe-abb5-4123-8ace-6d9b963387c7';
const MODE = process.argv[2] || 'normal';

const env = {};
for (const line of readFileSync(REPO + '/.env.project', 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const t0 = Date.now();
const rel = () => String(Date.now() - t0).padStart(6) + 'ms';
const log = (...a) => console.log(rel(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const res = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.RANCH_LOGIN, password: env.RANCH_PASS }),
  });
  const json = await res.json().catch(() => ({}));
  const data = json.data ?? json;
  const token = data.accessToken ?? data.access_token ?? data.token;
  log('login', res.status, 'keys:', Object.keys(data).join(','), 'token:', token ? 'yes' : 'NO');
  if (!token) throw new Error('no token');
  return token;
}

function connect(token) {
  const socket = io(API + '/ws/client', {
    transports: ['websocket'],
    reconnection: false,
    auth: { agentId: AGENT, capabilities: ['thinking'], token },
  });
  const seen = [];
  const short = (s) => (s ?? '').replace(/\s+/g, ' ').slice(0, 70);
  socket.on('connect', () => log('connect', socket.id));
  socket.on('disconnect', (r) => log('disconnect', r));
  socket.on('connect_error', (e) => log('connect_error', e.message));
  socket.on('welcome', (d) => log('welcome', JSON.stringify(d)));
  socket.on('bridle_error', (d) => log('bridle_error', JSON.stringify(d)));
  socket.on('message_error', (d) => log('message_error', JSON.stringify(d)));
  socket.on('agent_status', (d) => log('agent_status', JSON.stringify(d)));
  socket.on('typing', () => { seen.push('typing'); log('typing'); });
  socket.on('thinking', (e) => {
    seen.push('thinking');
    log('thinking', 'turn=' + String(e.turnId).slice(0, 8), e.done ? 'DONE' : 'step=' + (e.step?.label ?? e.step?.id ?? ''), 'skew=' + (e.ts - Date.now()) + 'ms');
  });
  let streamChunks = 0;
  socket.on('stream', (d) => {
    streamChunks++;
    if (streamChunks === 1 || streamChunks % 25 === 0) log('stream #' + streamChunks, 'id=' + String(d.messageId).slice(0, 8), 'len=' + (d.text ?? '').length);
    seen.push('stream');
  });
  socket.on('stream_end', (d) => {
    seen.push('stream_end');
    log('stream_end', 'id=' + String(d.messageId).slice(0, 8), 'skew=' + ((d.ts ?? NaN) - Date.now()) + 'ms', 'seq=' + d.seq, '"' + short(d.text) + '"');
    streamChunks = 0;
  });
  socket.on('message', (d) => {
    seen.push('message');
    log('message', 'id=' + String(d.messageId).slice(0, 8), 'skew=' + ((d.ts ?? NaN) - Date.now()) + 'ms', '"' + short(d.text) + '"');
  });
  return { socket, seen };
}

async function transcriptTail(token, n) {
  const res = await fetch(`${API}/api/agent/${AGENT}/transcript`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  const json = await res.json().catch(() => ({}));
  const data = json.data ?? json;
  const msgs = data.messages ?? [];
  log('transcript', res.status, 'count=' + msgs.length, 'hasMore=' + data.hasMore);
  for (const m of msgs.slice(-n)) {
    console.log('        ', m.role.padEnd(9), 'id=' + String(m.id).slice(0, 8), new Date(m.ts).toISOString().slice(11, 23), '"' + (m.text ?? '').replace(/\s+/g, ' ').slice(0, 90) + '"');
  }
  return msgs;
}

const token = await login();

if (MODE === 'normal') {
  const { socket, seen } = connect(token);
  await sleep(1500);
  let acked = false;
  const clientMessageId = 'probe-' + Date.now();
  log('SEND (with ack callback + clientMessageId=' + clientMessageId + ')');
  socket.emit('message', { text: 'Привет! Это тест чата. Ответь одним коротким предложением.', clientMessageId }, (a) => {
    acked = true;
    log('ACK', JSON.stringify(a));
  });
  await sleep(45000);
  log('ack callback called:', acked, '| events:', [...new Set(seen)].join(','));
  socket.close();
  await sleep(2000);
  await transcriptTail(token, 6);
}

if (MODE === 'gap') {
  const a = connect(token);
  await sleep(1500);
  log('SEND long question');
  a.socket.emit('message', { text: 'Тест обрыва связи. Перечисли пять фактов о лошадях, по одному предложению на факт.' });
  // Drop the socket as soon as the agent shows any sign of life.
  while (!a.seen.length && Date.now() - t0 < 30000) await sleep(100);
  log('>>> dropping socket mid-turn (events so far: ' + a.seen.join(',') + ')');
  a.socket.close();
  await sleep(25000);
  log('>>> reconnecting');
  const b = connect(token);
  await sleep(25000);
  log('events after reconnect:', b.seen.length ? [...new Set(b.seen)].join(',') : 'NONE');
  b.socket.close();
  await sleep(1500);
  await transcriptTail(token, 4);
}

if (MODE === 'steal') {
  // Two "tabs" of the same admin user. A connects first and sends; B connects second.
  const a = connect(token);
  await sleep(1200);
  const b = connect(token);
  await sleep(1200);
  log('SEND from tab A (the one that connected FIRST)');
  a.socket.emit('message', { text: 'Тест двух вкладок. Ответь одним словом: ок.' });
  await sleep(20000);
  log('tab A received:', a.seen.length ? [...new Set(a.seen)].join(',') : 'NOTHING');
  log('tab B received:', b.seen.length ? [...new Set(b.seen)].join(',') : 'NOTHING');
  a.socket.close();
  b.socket.close();
  await sleep(1000);
}

process.exit(0);
