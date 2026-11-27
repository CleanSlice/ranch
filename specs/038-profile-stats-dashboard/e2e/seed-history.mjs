// CLEAN-261 evidence: history is filled from transcripts, and only raised.
//
//   node seed-history.mjs [--days 120]   accounts, agents, storage, and
//                                        conversations with transcripts whose
//                                        messages are spread over the days
//   node seed-history.mjs --check        compare ChatActivityHour with what
//                                        the transcripts say, hour by hour
//   node seed-history.mjs --stats        compare GET /me/stats with the same
//                                        plan: the Owner and the User, three
//                                        periods, two time zones (SC-001)
//
// Seeding also writes what a transcript cannot carry, straight into the
// scratch database: two ratings, three citations and one hand-over per
// person, on their newest closed conversation with Front Desk; and a hundred
// days of usage through the report route, with a change of model ten days
// ago, so "who answers you" has days to go by.
//
// The conversations are written as files, the way a runtime leaves them, and
// indexed with the admin reconcile. Nothing here sends `session_activity`, so
// the hour rows can only come from the settle pass: `--check` after it has run
// is the proof of contracts/collection.md section 3.
//
// What `--check` expects is computed from the plan below and from nothing the
// API returned. The plan is deterministic for a given UTC day and `--days`, so
// seeding and checking on the same day agree.
//
// Every conversation ends at least two hours ago: the settle pass waits for an
// hour of quiet, and a check must not depend on the minute it is run.
//
// Runs with the environment of the API under test (README of the 035
// evidence): `lib.mjs` refuses anything but a local API and a database with
// "e2e" in its name. Everything written here is made up. Nothing is printed
// that came from the environment.
import { createRequire } from "node:module";
import path from "node:path";
import {
  API,
  api,
  check,
  DATABASE_URL,
  prisma,
  REPO,
  summary,
} from "../../035-tool-reconnect-chat-queue/evidence/lib.mjs";
import {
  ACCOUNTS,
  AGENTS,
  login,
  seed,
} from "../../035-tool-reconnect-chat-queue/evidence/seed.mjs";

const require = createRequire(path.join(REPO, "api/package.json"));
const {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

// One bucket per scratch database, named after it. A shared bucket keeps the
// files of an earlier day's plan, the reconcile indexes them beside today's,
// and the Owner (whose chat identity is `admin` in every database) ends up
// with two sets of conversations where the plan knows one.
const BUCKET = new URL(DATABASE_URL).pathname.slice(1).toLowerCase();

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// A small seeded generator: the same plan on every run of the same day.
function rng(seedValue) {
  let s = seedValue >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── Storage: a bucket on the local MinIO, and the API told about it ──────
async function storage(ownerToken) {
  const endpoint = need("S3_ENDPOINT");
  const host = new URL(endpoint).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("The transcripts are written to a local store only.");
  }
  const credentials = {
    accessKeyId: need("S3_ACCESS_KEY"),
    secretAccessKey: need("S3_SECRET_KEY"),
  };
  const region = process.env.S3_REGION || "us-east-1";
  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials,
  });
  try {
    await client.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
  const settings = {
    s3_bucket: BUCKET,
    s3_endpoint: endpoint,
    aws_region: region,
    aws_access_key_id: credentials.accessKeyId,
    aws_secret_access_key: credentials.secretAccessKey,
  };
  for (const [name, value] of Object.entries(settings)) {
    const res = await api("PUT", `/settings/integrations/${name}`, {
      token: ownerToken,
      body: { valueType: "string", value },
    });
    if (res.status >= 300) throw new Error(`setting ${name}: ${res.status}`);
  }
}

/** The archive's own way of writing a moment into a file name. */
const stamp = (at) => new Date(at).toISOString().replace(/[:.]/g, "-");

/**
 * One person's conversations with one agent over `days`: one every three
 * days, each with two to six turns in one to three sittings, a sitting being a
 * different hour and sometimes the next day. The newest stays open; the rest
 * were closed with New chat.
 */
function plan(today, days, clientId, agent, seedValue) {
  const next = rng(seedValue);
  const conversations = [];
  for (let ago = days - 1; ago >= 1; ago -= 3) {
    const start = today - ago * DAY + (8 + Math.floor(next() * 10)) * HOUR;
    const sittings = 1 + Math.floor(next() * 3);
    const messages = [];
    let at = start + Math.floor(next() * 50) * MIN;
    for (let s = 0; s < sittings; s++) {
      const turns = 1 + Math.floor(next() * 2);
      for (let t = 0; t < turns; t++) {
        messages.push({ type: "user", ts: at });
        at += MIN;
        messages.push({ type: "assistant", ts: at });
        at += 3 * MIN;
      }
      // The next sitting: later the same day, or the morning after.
      at += next() < 0.3 ? 20 * HOUR : (1 + Math.floor(next() * 3)) * HOUR;
    }
    conversations.push({ agent, clientId, messages });
  }
  // Nothing may reach into the last two hours. Cut at a fixed point of the
  // UTC day, not at the clock, so the plan is the same whenever it is made
  // that day: seeding in the morning and checking in the evening agree.
  const limit = today - 2 * HOUR;
  const kept = conversations
    .map((c) => ({ ...c, messages: c.messages.filter((m) => m.ts < limit) }))
    .filter((c) => c.messages.length > 0);
  return kept.map((c, i) => {
    const endedAt = c.messages[c.messages.length - 1].ts;
    const running = i === kept.length - 1;
    const key = running
      ? `bridle:${clientId}`
      : `bridle:${clientId}.${stamp(endedAt)}.archived`;
    return { ...c, key, endedAt };
  });
}

function transcript(c) {
  return (
    c.messages
      .map((m, i) =>
        JSON.stringify({
          id: `${c.key}-${i}`,
          type: m.type,
          ts: m.ts,
          data: { text: m.type === "user" ? `Question ${i}` : `Answer ${i}` },
        }),
      )
      .join("\n") + "\n"
  );
}

/** hour (ISO) -> [userMessages, agentMessages], from the plan alone. */
function hoursOf(c) {
  const hours = new Map();
  for (const m of c.messages) {
    const hour = new Date(Math.floor(m.ts / HOUR) * HOUR).toISOString();
    const h = hours.get(hour) ?? [0, 0];
    h[m.type === "user" ? 0 : 1] += 1;
    hours.set(hour, h);
  }
  return [...hours].sort(([a], [b]) => (a < b ? -1 : 1));
}

// ── What `GET /me/stats` must answer, from the plan alone ────────────────
const ZONES = ["Europe/Kyiv", "America/Los_Angeles"];
const PERIODS = [7, 30, 90];

/** The calendar day of an instant in a zone, `YYYY-MM-DD`. */
function dayIn(ts, zone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}
const shiftDay = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Monday = 0. */
const weekdayOf = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/**
 * One person's figures for a period in a zone. `conversations` are that
 * person's, with the agents they reach. A conversation counts where the
 * person wrote in it: in a period, and on each day.
 */
function expectedStats(conversations, period, zone, nowTs) {
  const today = dayIn(nowTs, zone);
  const from = shiftDay(today, -(period - 1));
  const previousFrom = shiftDay(from, -period);
  const inPeriod = (d) => d >= from && d <= today;
  const inPrevious = (d) => d >= previousFrom && d < from;

  let messages = 0;
  let previousMessages = 0;
  const current = new Set();
  const previous = new Set();
  const answered = new Set();
  const byAgent = new Map();
  const byDay = new Map();
  for (const c of conversations) {
    const id = `${c.agent.id}|${c.key}`;
    for (const m of c.messages) {
      const d = dayIn(m.ts, zone);
      if (m.type !== "user") {
        if (inPeriod(d)) answered.add(c.agent.id);
        continue;
      }
      if (inPeriod(d)) {
        messages += 1;
        current.add(id);
        const a = byAgent.get(c.agent.id) ?? { messages: 0, ids: new Set() };
        a.messages += 1;
        a.ids.add(id);
        byAgent.set(c.agent.id, a);
      }
      if (inPrevious(d)) {
        previousMessages += 1;
        previous.add(id);
      }
      const set = byDay.get(d) ?? new Set();
      set.add(id);
      byDay.set(d, set);
    }
  }
  const days = [];
  for (let i = 90; i >= 0; i--) {
    const date = shiftDay(today, -i);
    days.push([date, byDay.get(date)?.size ?? 0]);
  }
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  let activeDays = 0;
  for (const [date, n] of days) {
    if (!inPeriod(date) || n === 0) continue;
    weekdays[weekdayOf(date)] += n;
    activeDays += 1;
  }
  return {
    conversations: [current.size, previous.size],
    messages: [messages, previousMessages],
    agentsAnswered: answered.size,
    days,
    weekdays,
    activeDays,
    agents: [...byAgent]
      .map(([agentId, a]) => [agentId, a.messages, a.ids.size])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}

/** The same figures, as the API answered them. */
function answeredStats(data) {
  return {
    conversations: [
      data.board.conversations.value,
      data.board.conversations.previous,
    ],
    messages: [data.board.messages.value, data.board.messages.previous],
    agentsAnswered: data.board.agents.value,
    days: data.activity.days.map((d) => [d.date, d.conversations]),
    weekdays: data.activity.weekdays,
    activeDays: data.activity.activeDays,
    agents: data.agents
      .map((a) => [a.agentId, a.messages, a.conversations])
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  };
}

// ── What the files cannot carry: ratings, citations, a hand-over, usage ──
/** The conversation the extras hang on: this person's newest closed one with Front Desk. */
function anchor(all, clientId) {
  const mine = all.filter(
    (c) => c.clientId === clientId && c.agent === AGENTS.A && c.key.endsWith(".archived"),
  );
  return mine[mine.length - 1];
}

async function extras(all, people) {
  const db = prisma();
  for (const { clientId, authorId } of people) {
    const c = anchor(all, clientId);
    if (!c) continue;
    const session = await db.chatSession.findFirst({
      where: { agentId: c.agent.id, sessionKey: c.key },
    });
    if (!session) throw new Error(`not indexed: ${c.key}`);
    const answers = c.messages
      .map((m, i) => ({ ...m, id: `${c.key}-${i}` }))
      .filter((m) => m.type === "assistant");
    const first = answers[0];
    const last = answers[answers.length - 1];

    // Two ratings by this person: one up, one down.
    await db.chatFeedback.deleteMany({ where: { sessionId: session.id } });
    await db.chatFeedback.createMany({
      data: [
        { sessionId: session.id, messageId: first.id, rating: 1, source: "app", authorId, createdAt: new Date(first.ts + MIN) },
        { sessionId: session.id, messageId: last.id, rating: -1, source: "app", authorId, createdAt: new Date(last.ts + MIN) },
      ],
    });

    // Three citations on the first answer: a knowledge base twice, the web once.
    await db.chatMessageSource.deleteMany({ where: { messageId: first.id } });
    await db.chatMessageSource.createMany({
      data: [
        { agentId: c.agent.id, clientId, sessionKey: `bridle:${clientId}`, messageId: first.id, n: 1, kind: "knowledge", knowledgeId: "kb-e2e-docs", knowledgeName: "Docs KB", name: "Deploying an agent", createdAt: new Date(first.ts) },
        { agentId: c.agent.id, clientId, sessionKey: `bridle:${clientId}`, messageId: first.id, n: 2, kind: "knowledge", knowledgeId: "kb-e2e-docs", knowledgeName: "Docs KB", name: "Request limits", createdAt: new Date(first.ts) },
        { agentId: c.agent.id, clientId, sessionKey: `bridle:${clientId}`, messageId: first.id, n: 3, kind: "web", name: "kubernetes.io", url: "https://kubernetes.io/docs/", createdAt: new Date(first.ts) },
      ],
    });

    // One hand-over to Back Office while answering this person, answered.
    await db.agentDelegation.deleteMany({ where: { clientId, contextId: "ctx-e2e-258" } });
    await db.agentDelegation.create({
      data: {
        agentId: AGENTS.A.id,
        peerAgentId: AGENTS.B.id,
        peerName: AGENTS.B.name,
        contextId: "ctx-e2e-258",
        clientId,
        task: "Are the October invoices closed?",
        reason: "Back Office keeps the invoices.",
        status: "answered",
        startedAt: new Date(last.ts - 30_000),
        finishedAt: new Date(last.ts - 5_000),
        durationMs: 25_000,
      },
    });
  }

  // Usage, so "who answers you" has days to go by: Front Desk changed its
  // model ten days ago; Back Office has one model and one it has no price for.
  const key = need("BRIDLE_API_KEY");
  const API_URL = API;
  const today = Math.floor(Date.now() / DAY) * DAY;
  for (let ago = 1; ago <= 100; ago++) {
    const date = new Date(today - ago * DAY).toISOString().slice(0, 10);
    const reports = [
      [AGENTS.A, { [ago > 10 ? "claude-haiku-4-5" : "claude-sonnet-4-6"]: { inputTokens: 40_000 + ago * 900, outputTokens: 9_000 + ago * 200, callCount: 20 + (ago % 7) } }],
      [AGENTS.B, { "claude-sonnet-4-6": { inputTokens: 15_000, outputTokens: 3_000, callCount: 8 }, "local/llama-3.1-70b": { inputTokens: 6_000, outputTokens: 1_500, callCount: 4 } }],
    ];
    for (const [agent, byModel] of reports) {
      const res = await fetch(`${API_URL}/agents/${agent.id}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bridle-api-key": key },
        body: JSON.stringify({ date, byModel }),
      });
      if (res.status >= 300) throw new Error(`usage ${agent.name} ${date}: ${res.status}`);
    }
  }
}

async function checkStats(all, userId) {
  const now = Date.now();
  const people = [
    // The Owner reaches every agent; the User reaches Front Desk only.
    { name: "owner", email: ACCOUNTS.owner.email, mine: all.filter((c) => c.clientId === "admin") },
    { name: "user", email: ACCOUNTS.user.email, mine: all.filter((c) => c.clientId === userId && c.agent === AGENTS.A) },
  ];
  for (const person of people) {
    const { accessToken } = await login(person.email);
    for (const zone of ZONES) {
      for (const period of PERIODS) {
        const res = await api("GET", `/me/stats?period=${period}&tz=${encodeURIComponent(zone)}`, { token: accessToken });
        const label = `${person.name} ${period}d ${zone}`;
        if (res.status !== 200) {
          check(`${label}: answers`, res.status, 200);
          continue;
        }
        check(label, answeredStats(res.data), expectedStats(person.mine, period, zone, now));
        if (period === 30 && zone === ZONES[0]) {
          // The extras hang on a conversation of the last three days.
          check(`${label}: ratings`, res.data.help.ratings, { up: 1, down: 1 });
          check(`${label}: cited`, [res.data.help.cited.conversations, res.data.help.cited.sources], [1, [{ name: "Docs KB", citations: 2 }, { name: "web", citations: 1 }]]);
          check(`${label}: hand-overs`, [res.data.help.handovers.total, res.data.help.handovers.answered], [1, 1]);
          console.log(`      models: ${JSON.stringify(res.data.models)} | reachable: ${res.data.board.agents.reachable} | top peer: ${JSON.stringify(res.data.help.handovers.topPeer)}`);
        }
      }
    }
  }
}

async function main() {
  const days = Number(option("--days", "120"));
  if (!Number.isInteger(days) || days < 2) throw new Error("--days: 2 or more");

  const { ownerToken, userId } = await seed();
  const today = Math.floor(Date.now() / DAY) * DAY;
  // The Owner's conversations are kept under `admin`; everyone else's under
  // their own id. The User reaches Front Desk only.
  const all = [
    ...plan(today, days, "admin", AGENTS.A, 1),
    ...plan(today, days, "admin", AGENTS.B, 2),
    ...plan(today, days, userId, AGENTS.A, 3),
  ];

  if (flag("--stats")) {
    await checkStats(all, userId);
    process.exitCode = summary() ? 1 : 0;
    return;
  }

  if (flag("--check")) {
    const db = prisma();
    let hours = 0;
    for (const c of all) {
      const session = await db.chatSession.findFirst({
        where: { agentId: c.agent.id, sessionKey: c.key },
        include: { activityHours: { orderBy: { hour: "asc" } } },
      });
      const got = (session?.activityHours ?? []).map((h) => [
        h.hour.toISOString(),
        [h.userMessages, h.agentMessages],
      ]);
      const want = hoursOf(c);
      hours += want.length;
      check(`${c.agent.name} ${c.key}`, got, want);
    }
    console.log(`${all.length} conversations, ${hours} hours expected`);
    process.exitCode = summary() ? 1 : 0;
    return;
  }

  await storage(ownerToken);
  for (const c of all) {
    const route =
      `/agents/${c.agent.id}/files/content?path=` +
      encodeURIComponent(`data/sessions/${c.key}.jsonl`);
    const res = await api("PUT", route, {
      token: ownerToken,
      body: { content: transcript(c) },
    });
    if (res.status >= 300) {
      throw new Error(`transcript ${c.key}: ${res.status} ${res.text.slice(0, 200)}`);
    }
  }
  // The admin reconcile reads the files into the index for everyone at once.
  for (const agent of [AGENTS.A, AGENTS.B]) {
    const res = await api("POST", "/chats/sync", {
      token: ownerToken,
      body: { agentId: agent.id },
    });
    if (res.status >= 300) {
      throw new Error(`sync ${agent.name}: ${res.status} ${res.text.slice(0, 200)}`);
    }
  }
  // The owner's user id, for the ratings: the Owner's conversations are kept
  // under `admin`, a rating under the account that gave it.
  const owner = await prisma().user.findFirst({
    where: { email: ACCOUNTS.owner.email },
  });
  await extras(all, [
    { clientId: "admin", authorId: owner.id },
    { clientId: userId, authorId: userId },
  ]);
  const messages = all.reduce((n, c) => n + c.messages.length, 0);
  console.log(
    `seeded ${all.length} conversations, ${messages} messages over ${days} days`,
  );
}

await main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma().$disconnect());
