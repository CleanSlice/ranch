// CLEAN-261 evidence: every message is counted once, in its hour.
//
// Connects to the local API's agent socket as the runtime of one seeded agent
// and sends a fixed set of `session_activity` events: two conversations, both
// roles, timestamps in three UTC hours. Then it reads the scratch database and
// checks the invariant of contracts/collection.md section 2: for each
// conversation the hour rows add up to the lifetime totals.
//
//   node replay.mjs               each event once
//   node replay.mjs --twice       each event twice in a row, as a retry would
//   node replay.mjs --concurrent  two different events for one conversation together
//   node replay.mjs --clean       remove what this script wrote, then exit
//
// `--twice` is a repeat of the same event right after itself, because that is
// the only repeat the hub refuses (a watermark on the last event counted) and
// the only one that can happen: the runtime reports each message once and
// never retries. Every run starts by removing what the previous one wrote,
// since the watermark does not span runs.
//
// Runs against a local API on a scratch database only: `lib.mjs` of spec 035
// refuses anything else. It takes the API's environment (`BRIDLE_API_KEY`,
// `DATABASE_URL` or `E2E_DATABASE_URL`) plus `E2E_API`.
import {
  API,
  BRIDLE_API_KEY,
  check,
  io,
  prisma,
  sleep,
  summary,
} from "../../035-tool-reconnect-chat-queue/evidence/lib.mjs";
import {
  AGENTS,
  seed,
} from "../../035-tool-reconnect-chat-queue/evidence/seed.mjs";

const args = new Set(process.argv.slice(2));
const AGENT = AGENTS.A;
// Client ids no real account can have, so the clean-up removes exactly these.
const CLIENTS = ["replay-038-a", "replay-038-b"];
const key = (client) => `bridle:${client}`;

// A fixed day in the past, so every run lands in the same three hours.
const DAY = Date.UTC(2026, 10, 20);
const at = (hour, minute) => DAY + hour * 3_600_000 + minute * 60_000;

/** [client, role, hour, minute] */
const SET = [
  [0, "user", 10, 5],
  [0, "assistant", 10, 6],
  [0, "user", 10, 40],
  [0, "assistant", 11, 2],
  [0, "user", 13, 30],
  [0, "assistant", 13, 31],
  [1, "user", 11, 15],
  [1, "assistant", 11, 16],
  [1, "user", 11, 59],
];

function event(row, n) {
  const [client, role, hour, minute] = row;
  return {
    sessionKey: key(CLIENTS[client]),
    channel: "bridle",
    externalUserId: CLIENTS[client],
    eventId: `replay-038-${n}`,
    role,
    ts: at(hour, minute),
    preview: `${role} ${hour}:${String(minute).padStart(2, "0")}`,
  };
}

/** What the set must produce, computed from the set and from nothing else. */
function expected(events) {
  const bySession = new Map();
  for (const e of events) {
    const s = bySession.get(e.sessionKey) ?? {
      messages: 0,
      user: 0,
      hours: new Map(),
    };
    s.messages += 1;
    if (e.role === "user") s.user += 1;
    const hour = new Date(
      Math.floor(e.ts / 3_600_000) * 3_600_000,
    ).toISOString();
    const h = s.hours.get(hour) ?? { user: 0, agent: 0 };
    if (e.role === "user") h.user += 1;
    else h.agent += 1;
    s.hours.set(hour, h);
    bySession.set(e.sessionKey, s);
  }
  return bySession;
}

async function clean() {
  const db = prisma();
  // The hour rows go with their conversation (cascade).
  const gone = await db.chatSession.deleteMany({
    where: {
      agentId: AGENT.id,
      externalUserId: { in: CLIENTS },
    },
  });
  console.log(`removed ${gone.count} conversation(s) of this script`);
}

async function connect() {
  const socket = io(`${API}/ws/agent`, {
    transports: ["websocket"],
    auth: { apiKey: BRIDLE_API_KEY, agentId: AGENT.id },
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

async function stored() {
  const db = prisma();
  const sessions = await db.chatSession.findMany({
    where: { agentId: AGENT.id, externalUserId: { in: CLIENTS } },
    include: { activityHours: { orderBy: { hour: "asc" } } },
  });
  return new Map(sessions.map((s) => [s.sessionKey, s]));
}

await seed();
await clean();
if (args.has("--clean")) {
  await prisma().$disconnect();
  process.exit(0);
}

const socket = await connect();
const events = SET.map(event);

if (args.has("--concurrent")) {
  // Two different events of one conversation in the same tick: both counted.
  const [first, second, ...rest] = events;
  socket.emit("session_activity", first);
  socket.emit("session_activity", second);
  for (const e of rest) {
    await sleep(40);
    socket.emit("session_activity", e);
  }
} else {
  for (const e of events) {
    socket.emit("session_activity", e);
    if (args.has("--twice")) socket.emit("session_activity", e);
    // One at a time, so "the last event counted" is the one just sent.
    await sleep(40);
  }
}

// The handler does not wait for the write; give the last one time to land.
await sleep(1_500);
socket.close();

const want = expected(events);
const got = await stored();

for (const [sessionKey, w] of want) {
  const s = got.get(sessionKey);
  check(`${sessionKey}: conversation is indexed`, Boolean(s), true);
  if (!s) continue;
  check(`${sessionKey}: messageCount`, s.messageCount, w.messages);
  check(`${sessionKey}: userMessageCount`, s.userMessageCount, w.user);

  const hours = s.activityHours;
  check(
    `${sessionKey}: sum(userMessages) = userMessageCount`,
    hours.reduce((n, h) => n + h.userMessages, 0),
    s.userMessageCount,
  );
  check(
    `${sessionKey}: sum(all messages) = messageCount`,
    hours.reduce((n, h) => n + h.userMessages + h.agentMessages, 0),
    s.messageCount,
  );
  check(
    `${sessionKey}: hours`,
    hours.map((h) => [h.hour.toISOString(), h.userMessages, h.agentMessages]),
    [...w.hours]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([hour, h]) => [hour, h.user, h.agent]),
  );
  check(
    `${sessionKey}: copies on every hour row`,
    hours.every(
      (h) =>
        h.agentId === AGENT.id &&
        h.channel === "bridle" &&
        h.externalUserId === s.externalUserId,
    ),
    true,
  );
}

const failed = summary();
await prisma().$disconnect();
process.exit(failed ? 1 : 0);
