// Probe the bridle hub the way a browser does (CLEAN-102). Prints no secrets.
//
//   node specs/015-chat-message-reliability/probe.mjs <mode>
//
//   normal   one turn; shows the delivery ack and every event with its seq
//   steal    two sockets of one login, the FIRST one sends — who gets the answer?
//   gap      drop the socket mid-turn, reconnect with lastSeq — is the answer replayed?
//   offline  send while the agent is disconnected — rejection, or a fake agent reply?
//
// API_URL / AGENT_ID override the local defaults. Credentials come from
// RANCH_LOGIN / RANCH_PASS in .env.project at the repo root.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(REPO, 'package.json'));
const { io } = require('socket.io-client');

const API = process.env.API_URL || 'http://localhost:3333';
const AGENT = process.env.AGENT_ID || 'agent-bb620efe-abb5-4123-8ace-6d9b963387c7';
const MODE = process.argv[2] || 'normal';

const env = {};
for (const line of readFileSync(resolve(REPO, '.env.project'), 'utf8').split(/\r?\n/)) {
  const i = line.indexOf('=');
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}

const t0 = Date.now();
const rel = () => String(Date.now() - t0).padStart(6) + 'ms';
const log = (...a) => console.log(rel(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s) => (s ?? '').replace(/\s+/g, ' ').slice(0, 70);
const id8 = (s) => String(s).slice(0, 8);

async function login() {
  const res = await fetch(API + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.RANCH_LOGIN, password: env.RANCH_PASS }),
  });
  const json = await res.json().catch(() => ({}));
  const token = (json.data ?? json).accessToken;
  log('login', res.status, 'token:', token ? 'yes' : 'NO');
  if (!token) throw new Error('login failed');
  return token;
}

function connect(token, name, lastSeq = 0) {
  const socket = io(API + '/ws/client', {
    transports: ['websocket'],
    reconnection: false,
    auth: { agentId: AGENT, capabilities: ['thinking'], token, lastSeq },
  });
  const state = { socket, seen: [], lastSeq };
  const note = (type, seq) => {
    state.seen.push(type);
    if (typeof seq === 'number') state.lastSeq = Math.max(state.lastSeq, seq);
  };
  const tag = `[${name}]`;
  socket.on('connect', () => log(tag, 'connect'));
  socket.on('disconnect', (r) => log(tag, 'disconnect', r));
  socket.on('connect_error', (e) => log(tag, 'connect_error', e.message));
  socket.on('welcome', (d) => log(tag, 'welcome', JSON.stringify(d)));
  socket.on('bridle_error', (d) => log(tag, 'bridle_error', JSON.stringify(d)));
  socket.on('message_error', (d) => log(tag, 'message_error', JSON.stringify(d)));
  socket.on('agent_status', (d) => log(tag, 'agent_status connected=' + d.connected));
  socket.on('typing', (d) => { note('typing', d?.seq); log(tag, 'typing', 'seq=' + d?.seq); });
  socket.on('thinking', (e) => {
    note('thinking', e.seq);
    log(tag, 'thinking', e.done ? 'DONE' : 'step', 'seq=' + e.seq);
  });
  let chunks = 0;
  socket.on('stream', (d) => {
    note('stream', d.seq);
    if (++chunks === 1) log(tag, 'stream (first chunk)', 'id=' + id8(d.messageId), 'seq=' + d.seq);
  });
  socket.on('stream_end', (d) => {
    note('stream_end', d.seq);
    chunks = 0;
    log(tag, 'stream_end', 'id=' + id8(d.messageId), 'seq=' + d.seq, 'skew=' + ((d.ts ?? NaN) - Date.now()) + 'ms', '"' + short(d.text) + '"');
  });
  socket.on('message', (d) => {
    note('message', d.seq);
    log(tag, 'message', 'id=' + id8(d.messageId), 'seq=' + d.seq, '"' + short(d.text) + '"');
  });
  socket.on('user_message', (d) => {
    note('user_message', d.seq);
    log(tag, 'user_message', 'id=' + id8(d.messageId), 'seq=' + d.seq, '"' + short(d.text) + '"');
  });
  return state;
}

function send(state, text, clientMessageId = 'probe-' + Date.now()) {
  return new Promise((done) => {
    const timer = setTimeout(() => { log('ACK: none within 30s'); done(null); }, 30000);
    state.socket.emit('message', { text, clientMessageId }, (ack) => {
      clearTimeout(timer);
      log('ACK', JSON.stringify(ack));
      done(ack);
    });
  });
}

const summary = (s) => (s.seen.length ? [...new Set(s.seen)].join(',') : 'NOTHING');
const token = await login();

if (MODE === 'normal') {
  const a = connect(token, 'A');
  await sleep(1500);
  log('SEND');
  await send(a, 'Привет! Это тест чата. Ответь одним коротким предложением.');
  await sleep(15000);
  log('received:', summary(a));
  a.socket.close();
}

if (MODE === 'steal') {
  const a = connect(token, 'A');
  await sleep(1200);
  const b = connect(token, 'B');
  await sleep(1200);
  log('SEND from A — the socket that connected FIRST');
  await send(a, 'Тест двух вкладок. Ответь одним словом: ок.');
  await sleep(15000);
  log('A received:', summary(a));
  log('B received:', summary(b));
  a.socket.close();
  b.socket.close();
}

if (MODE === 'gap') {
  const a = connect(token, 'A');
  await sleep(1500);
  log('SEND long question');
  void send(a, 'Тест обрыва связи. Перечисли пять фактов о лошадях, по одному предложению на факт.');
  while (!a.seen.includes('typing') && Date.now() - t0 < 30000) await sleep(50);
  log('>>> dropping the socket mid-turn; lastSeq=' + a.lastSeq);
  a.socket.close();
  await sleep(25000);
  log('>>> reconnecting with lastSeq=' + a.lastSeq);
  const b = connect(token, 'A2', a.lastSeq);
  await sleep(8000);
  log('after reconnect received:', summary(b));
  b.socket.close();
}

if (MODE === 'offline') {
  const a = connect(token, 'A');
  await sleep(1500);
  log('SEND (expecting the agent to be disconnected)');
  await send(a, 'Это сообщение не должно потеряться молча.');
  await sleep(3000);
  log('received:', summary(a), '— a "message" here means the hub faked an agent reply');
  a.socket.close();
}

await sleep(500);
process.exit(0);
