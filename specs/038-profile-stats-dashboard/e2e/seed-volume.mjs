// CLEAN-258 evidence: the statistics answer as fast in a large installation
// as in a small one (spec 038, SC-002).
//
//   node seed-volume.mjs --conversations 10000     index and hour rows only
//   node seed-volume.mjs --conversations 1000000   (replaces the previous set)
//   node seed-volume.mjs --measure                 time GET /me/stats, 90 days
//   node seed-volume.mjs --clean
//
// The rows have no transcripts: they are for timing, never for reading. Each
// conversation gets three hour rows, the settle stamp set so the pass leaves
// it alone, and an id that starts with `vol-`, which is all `--clean`
// removes. The conversations are spread over a year, between two agents and
// 20 000 made-up people; the seeded User gets 5 000 of their own with Front
// Desk, the "heavy user" of the criterion.
//
// `--measure` signs in as that User and asks for the 90-day view ten times;
// it prints the median and the slowest. Run it after each size and compare.
//
// Runs with the environment of the API under test: `lib.mjs` of spec 035
// refuses anything but a local API and a database with "e2e" in its name.
import {
  api,
  prisma,
} from "../../035-tool-reconnect-chat-queue/evidence/lib.mjs";
import {
  ACCOUNTS,
  AGENTS,
  login,
  seed,
} from "../../035-tool-reconnect-chat-queue/evidence/seed.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const HEAVY = 5_000;
const PEOPLE = 20_000;
/** Hour rows per conversation. */
const HOURS = 3;

async function clean(db) {
  // The hour rows go with their conversations (cascade).
  const gone = await db.$executeRawUnsafe(
    `DELETE FROM "ChatSession" WHERE id LIKE 'vol-%'`,
  );
  console.log(`removed ${gone} volume conversation(s)`);
}

// Timestamps are written as UTC wall time: the columns are `timestamp`
// without a zone, Prisma writes UTC into them, and the container's own zone
// is not UTC, so a bare now() would land hours away.
const UTC_NOW = `(now() AT TIME ZONE 'utc')`;

async function fill(db, total, userId) {
  const started = Date.now();
  // Everyone else's conversations, in batches so one statement stays small.
  const BATCH = 100_000;
  for (let from = 1; from <= total; from += BATCH) {
    const to = Math.min(total, from + BATCH - 1);
    await db.$executeRawUnsafe(
      `INSERT INTO "ChatSession"
         (id, "agentId", channel, "externalUserId", "sessionKey", "lastMessageAt",
          "messageCount", "userMessageCount", archived, "activityRebuiltAt", "createdAt", "updatedAt")
       SELECT 'vol-' || g,
              CASE WHEN g % 2 = 0 THEN $1 ELSE $2 END,
              'bridle',
              'vol-user-' || (g % ${PEOPLE}),
              'bridle:vol-' || g || '.archived',
              ${UTC_NOW} - make_interval(days => g % 365, mins => g % 1440) - interval '2 hours',
              6, 3, true, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW}
       FROM generate_series($3::int, $4::int) g`,
      AGENTS.A.id,
      AGENTS.B.id,
      from,
      to,
    );
    process.stdout.write(`\r  conversations: ${to} of ${total}`);
  }
  // The heavy user's own: with Front Desk, which the User reaches.
  await db.$executeRawUnsafe(
    `INSERT INTO "ChatSession"
       (id, "agentId", channel, "externalUserId", "sessionKey", "lastMessageAt",
        "messageCount", "userMessageCount", archived, "activityRebuiltAt", "createdAt", "updatedAt")
     SELECT 'vol-heavy-' || g, $1, 'bridle', $2,
            'bridle:' || $2 || '.vol-' || g || '.archived',
            ${UTC_NOW} - make_interval(days => g % 365, mins => g % 1440) - interval '2 hours',
            6, 3, true, ${UTC_NOW}, ${UTC_NOW}, ${UTC_NOW}
     FROM generate_series(1, ${HEAVY}) g`,
    AGENTS.A.id,
    userId,
  );
  process.stdout.write(`\n  hour rows…`);
  await db.$executeRawUnsafe(
    `INSERT INTO "ChatActivityHour"
       ("sessionId", hour, "agentId", channel, "externalUserId", "userMessages", "agentMessages")
     SELECT s.id, date_trunc('hour', s."lastMessageAt") - make_interval(hours => k),
            s."agentId", s.channel, s."externalUserId", 1, 1
     FROM "ChatSession" s CROSS JOIN generate_series(0, ${HOURS - 1}) k
     WHERE s.id LIKE 'vol-%'`,
  );
  await db.$executeRawUnsafe(`ANALYZE "ChatSession"`);
  await db.$executeRawUnsafe(`ANALYZE "ChatActivityHour"`);
  const sessions = await db.chatSession.count();
  const hours = await db.chatActivityHour.count();
  console.log(
    `\n  ${sessions} conversations, ${hours} hour rows in ${Math.round((Date.now() - started) / 1000)} s`,
  );
}

async function measure() {
  const { accessToken } = await login(ACCOUNTS.user.email);
  const route = "/me/stats?period=90&tz=Europe%2FKyiv";
  // One to warm the connection; it is not counted.
  const first = await api("GET", route, { token: accessToken });
  if (first.status !== 200) throw new Error(`stats: ${first.status}`);
  const times = [];
  for (let i = 0; i < 10; i++) {
    const at = performance.now();
    const res = await api("GET", route, { token: accessToken });
    times.push(performance.now() - at);
    if (res.status !== 200) throw new Error(`stats: ${res.status}`);
  }
  times.sort((a, b) => a - b);
  const median = (times[4] + times[5]) / 2;
  const db = prisma();
  console.log(
    `GET /me/stats 90 days, heavy user: median ${median.toFixed(0)} ms, slowest ${times[9].toFixed(0)} ms ` +
      `| conversations in the answer ${first.data.board.conversations.value}, messages ${first.data.board.messages.value} ` +
      `| installation: ${await db.chatSession.count()} conversations, ${await db.chatActivityHour.count()} hour rows`,
  );
}

async function main() {
  const db = prisma();
  if (flag("--measure")) return measure();
  const { userId } = await seed();
  await clean(db);
  if (flag("--clean")) return;
  const total = Number(option("--conversations", "10000"));
  if (!Number.isInteger(total) || total < 1) {
    throw new Error("--conversations: a positive whole number");
  }
  await fill(db, total, userId);
}

await main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma().$disconnect());
