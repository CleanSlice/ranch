// CLEAN-248: conversations for the history checks.
//
//   node seed.mjs                 accounts, agents, storage and a handful of
//                                 real conversations (transcripts and all)
//   node seed.mjs --count 200     plus 200 closed index rows for the volume
//                                 checks; they have no transcript, so they
//                                 are for the list, never for reading
//   node seed.mjs --clean         removes the bulk rows again
//
// Runs with the environment of the API under test (README of the 035
// evidence): `lib.mjs` refuses anything but a local API and a database with
// "e2e" in its name. Everything written here is made up. Nothing is printed
// that came from the environment.
import { createRequire } from "node:module";
import path from "node:path";
import {
  api,
  prisma,
  REPO,
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

const BUCKET = "ranch-e2e-248";
/** Marks the bulk rows, so `--clean` removes those and nothing else. */
const BULK = "seed-036-";
/** The one bulk row a search is meant to find from far down the list. */
export const NEEDLE = "zeppelin";

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

// ── Storage: a bucket on the local MinIO, and the API told about it ──────
async function storage(ownerToken) {
  const endpoint = need("S3_ENDPOINT");
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(endpoint)) {
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

// ── Transcripts ──────────────────────────────────────────────────────────
/** Turns as `[question, answer]`; the last answer lands at `endedAt`. */
function transcript(key, turns, endedAt) {
  const lines = [];
  let ts = endedAt - turns.length * 2 * MIN;
  turns.forEach(([question, answer], i) => {
    ts += MIN;
    lines.push({ id: `${key}-u${i}`, type: "user", ts, data: { text: question } });
    ts += MIN;
    lines.push({ id: `${key}-a${i}`, type: "assistant", ts, data: { text: answer } });
  });
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

/** The archive's own way of writing a moment into a file name. */
const stamp = (at) => new Date(at).toISOString().replace(/[:.]/g, "-");

const LONG = Array.from({ length: 20 }, (_, i) => [
  `Step ${i + 1}: what did pod agent-7f2c log at 02:${String(10 + i).padStart(2, "0")}?`,
  `At 02:${String(10 + i).padStart(2, "0")} it logged "image pulled, restarting" (line ${i + 1} of the night's log).`,
]);

/** What each account talked about, and with whom. `ago` is when it ended. */
function plan(now, clientId) {
  return [
    {
      agent: AGENTS.A,
      running: true,
      ago: 10 * MIN,
      turns: [
        ["What request limits are set right now?", "None: the agent is private, so a limit is optional."],
        ["And if I make the agent public?", "Then a limit is required. It is shared by the agent and the counter resets every minute."],
      ],
    },
    {
      agent: AGENTS.A,
      ago: 3 * HOUR,
      title: "Exporting a week of logs",
      summary: "The agent collected the pod's logs for seven days into one file.",
      insights: { topics: ["logs", "export"], sentiment: "positive", resolved: true, language: "en" },
      turns: [
        ["Collect the logs for the week into one file.", "Done: seven days of logs in one file."],
        ["Is the night of the 20th in there?", "Yes, from 00:00 to 23:59, with nothing missing."],
      ],
    },
    {
      agent: AGENTS.A,
      ago: DAY + 2 * HOUR,
      title: "Pods restarted overnight",
      summary:
        "Two pods restarted during the night: one after an image update, one on its memory limit. The second agent's memory was raised to 2Gi.",
      insights: { topics: ["pods", "memory", "restarts"], sentiment: "neutral", resolved: true, language: "en" },
      turns: [
        ["Which pods restarted during the night?", "Two: agent-7f2c at 02:14 after an image update, agent-a913 at 05:40 on its memory limit."],
        ...LONG,
        ["Raise the second one's memory to 2Gi.", "Done. The pod restarted with 2Gi and is Running."],
      ],
    },
    {
      agent: AGENTS.A,
      ago: 5 * DAY,
      title: "Setting up the Telegram channel",
      summary: "The channel is connected and text gets through. Attachments do not reach the agent; the question stayed open.",
      insights: { topics: ["telegram"], sentiment: "mixed", resolved: false, language: "en" },
      turns: [
        ["Connect a Telegram bot to this agent.", "The channel is connected. The bot answers, but attachments do not reach the agent yet."],
      ],
    },
    {
      agent: AGENTS.A,
      ago: 12 * DAY,
      // No title, no summary, not assessed: the row falls back to the neutral word.
      turns: [
        ["Is 2Gi enough for the research template?", "The template has 2Gi, which is enough for your scenario."],
      ],
    },
    {
      agent: AGENTS.A,
      ago: 21 * DAY,
      summary: "The public link to the chat was reissued and the old one revoked.",
      turns: [
        ["Reissue the link to the chat.", "Reissued. The old one no longer opens."],
      ],
    },
    {
      agent: AGENTS.B,
      running: true,
      ago: 40 * MIN,
      turns: [["Are the invoices for October closed?", "All but two; both wait for a signature."]],
    },
    {
      agent: AGENTS.B,
      ago: 2 * DAY,
      title: "Back office only: the October invoices",
      turns: [["List the open invoices.", "There are four, all from October."]],
    },
  ].map((c) => {
    const endedAt = now - c.ago;
    const key = c.running
      ? `bridle:${clientId}`
      : `bridle:${clientId}.${stamp(endedAt)}.archived`;
    return { ...c, endedAt, key };
  });
}

async function writeConversations(ownerToken, conversations) {
  for (const c of conversations) {
    const route =
      `/agents/${c.agent.id}/files/content?path=` +
      encodeURIComponent(`data/sessions/${c.key}.jsonl`);
    const res = await api("PUT", route, {
      token: ownerToken,
      body: { content: transcript(c.key, c.turns, c.endedAt) },
    });
    if (res.status >= 300) throw new Error(`transcript ${c.key}: ${res.status} ${res.text.slice(0, 200)}`);
  }
}

/** What the index cannot know from a file: the title, the summary, the assessment. */
async function decorate(conversations) {
  const db = prisma();
  for (const c of conversations) {
    await db.chatSession.updateMany({
      where: { agentId: c.agent.id, sessionKey: c.key },
      data: {
        title: c.title ?? null,
        summary: c.summary ?? null,
        summaryAt: c.summary ? new Date(c.endedAt) : null,
        ...(c.insights ? { insights: c.insights } : {}),
      },
    });
  }
}

// ── Bulk rows for the volume checks ──────────────────────────────────────
async function bulk(count, clientId, now) {
  const db = prisma();
  await db.chatSession.deleteMany({ where: { sessionKey: { contains: BULK } } });
  if (!count) return;
  const needleAt = Math.floor(count * 0.9);
  await db.chatSession.createMany({
    data: Array.from({ length: count }, (_, i) => {
      // Older than every real conversation of the week, spread over 60 days.
      const at = new Date(now - 7 * DAY - Math.floor((i / count) * 53 * DAY) - i * MIN);
      const special = i === needleAt;
      return {
        agentId: AGENTS.A.id,
        channel: "bridle",
        externalUserId: clientId,
        sessionKey: `bridle:${clientId}.${BULK}${String(i).padStart(4, "0")}.archived`,
        title: special ? `The ${NEEDLE} maintenance window` : `Seeded conversation ${i + 1}`,
        preview: `Last words of seeded conversation ${i + 1}.`,
        lastRole: "assistant",
        lastMessageAt: at,
        messageCount: 2 + (i % 39),
        userMessageCount: 1 + Math.floor((i % 39) / 2),
        archived: true,
      };
    }),
  });
}

async function main() {
  const db = prisma();
  if (flag("--clean")) {
    const { count } = await db.chatSession.deleteMany({
      where: { sessionKey: { contains: BULK } },
    });
    console.log(`removed ${count} bulk rows`);
    return;
  }

  const { ownerToken, userId } = await seed();
  await storage(ownerToken);

  const now = Date.now();
  // The Owner's conversations are kept under `admin`; everyone else's under
  // their own id (CLEAN-236).
  const owner = plan(now, "admin");
  // The User reaches Front Desk only.
  const user = plan(now, userId)
    .filter((c) => c.agent === AGENTS.A)
    .slice(0, 3);
  const all = [...owner, ...user];
  await writeConversations(ownerToken, all);

  // The admin reconcile reads the files into the index for everyone at once.
  for (const agent of [AGENTS.A, AGENTS.B]) {
    const res = await api("POST", "/chats/sync", {
      token: ownerToken,
      body: { agentId: agent.id },
    });
    if (res.status >= 300) throw new Error(`sync ${agent.name}: ${res.status} ${res.text.slice(0, 200)}`);
  }
  await decorate(all);
  await bulk(Number(option("--count", "0")), "admin", now);

  const rows = await db.chatSession.groupBy({
    by: ["agentId", "externalUserId", "archived"],
    _count: true,
  });
  for (const r of rows) {
    const agent = Object.values(AGENTS).find((a) => a.id === r.agentId)?.name ?? r.agentId;
    const who = r.externalUserId === "admin" ? "owner" : "user";
    console.log(`${agent} · ${who} · ${r.archived ? "closed" : "running"}: ${r._count}`);
  }
  // A sign-in proves the accounts work; the tokens are not shown.
  await login(ACCOUNTS.user.email);
  console.log("seeded");
}

await main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma().$disconnect());
