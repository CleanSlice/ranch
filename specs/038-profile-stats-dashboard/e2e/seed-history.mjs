// CLEAN-261 evidence: history is filled from transcripts, and only raised.
//
//   node seed-history.mjs [--days 120]   accounts, agents, storage, and
//                                        conversations with transcripts whose
//                                        messages are spread over the days
//   node seed-history.mjs --check        compare ChatActivityHour with what
//                                        the transcripts say, hour by hour
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
  api,
  check,
  prisma,
  REPO,
  summary,
} from "../../035-tool-reconnect-chat-queue/evidence/lib.mjs";
import {
  AGENTS,
  seed,
} from "../../035-tool-reconnect-chat-queue/evidence/seed.mjs";

const require = createRequire(path.join(REPO, "api/package.json"));
const {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

const BUCKET = "ranch-e2e-258";

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
  // Nothing may reach into the last two hours.
  const limit = Date.now() - 2 * HOUR;
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
