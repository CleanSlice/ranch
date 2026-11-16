// Seeds the local database for the request-limit browser checks (CLEAN-224).
//
//   node specs/030-agent-request-limits/e2e/seed.mjs
//
// Run it BEFORE the API starts: the hour and day agents get per-minute load
// rows that already fill their windows, and the API rebuilds its counters from
// those rows at boot. That is how a full hour or day window is tested without
// waiting an hour — and it exercises restart survival for real.
//
// Idempotent: every row is upserted or replaced, nothing else in the database
// is touched. Reads DATABASE_URL from api/.env; prints no secrets.
import { randomBytes } from 'node:crypto';
//
// For the Overview checks (CLEAN-228, specs/031-agent-overview-redesign) it
// also writes two active LLM credentials (dummy keys — they can call nothing),
// two knowledge bases, 30 days of usage for `limits-off` (two models, six days
// with none, some today), binds `limits-off` to the first credential, and
// keeps one more agent, `limits-stopped`, that no fake runtime connects for.
// Every fixture agent is also put back to its default name, model, knowledge
// selection, resources, description and debug mode.
import { AGENTS, FIXTURES as EXTRA, OWNER, USER, apiEnv, requireFromApi } from './lib.mjs';
import { APP } from '../../026-app-console-redesign/e2e/lib.mjs';

if (!apiEnv.DATABASE_URL) {
  console.error('DATABASE_URL is missing in api/.env');
  process.exit(1);
}
process.env.DATABASE_URL = apiEnv.DATABASE_URL;

const { PrismaClient } = requireFromApi('@prisma/client');
const bcrypt = requireFromApi('bcrypt');
const prisma = new PrismaClient();

const MIN = 60_000;
const HOUR = 60 * MIN;
const minuteStart = (t) => new Date(Math.floor(t / MIN) * MIN);

const TEMPLATE = {
  name: 'limits-e2e',
  description: 'Fixture template for the request-limit browser checks',
  image: 'limits-e2e:local',
};

/** name → visibility, limits and the load the API should find at boot. */
const FIXTURES = [
  {
    id: AGENTS.minute,
    name: 'limits-minute',
    isPublic: true,
    // The landing page previews public agents that allow its own origin.
    allowedOrigins: [APP],
    limits: { perMinute: 2 },
    load: [],
  },
  {
    id: AGENTS.hour,
    name: 'limits-hour',
    isPublic: true,
    allowedOrigins: [],
    limits: { perHour: 5 },
    // Five requests 55 minutes ago: the window is full and frees in about
    // five minutes, long enough for the checks that need it full.
    load: [{ ago: 55 * MIN, accepted: 5 }],
  },
  {
    id: AGENTS.day,
    name: 'limits-day',
    isPublic: true,
    allowedOrigins: [],
    limits: { perDay: 3 },
    // Three requests 21 hours ago: full for about three more hours.
    load: [{ ago: 21 * HOUR, accepted: 3 }],
  },
  {
    id: AGENTS.off,
    name: 'limits-off',
    isPublic: false,
    allowedOrigins: [],
    limits: null,
    load: [],
    llm: EXTRA.llm.primary.id,
  },
  // Public with no limits: only possible for an agent saved before limits
  // existed, which is exactly what writing the row directly reproduces.
  { id: AGENTS.legacy, name: 'limits-legacy', isPublic: true, allowedOrigins: [], limits: null, load: [] },
  { id: AGENTS.share, name: 'limits-share', isPublic: false, allowedOrigins: [], limits: null, load: [], share: true },
  // Stopped, and not in AGENTS: fakeAgent.mjs does not connect for it, and a
  // stopped agent is never resurrected by the status sweeps.
  {
    id: EXTRA.stopped.id,
    name: EXTRA.stopped.name,
    status: 'stopped',
    // It also holds the Ranch admin tools, so "demote asks first" has an
    // agent to be shown on (rest.mjs opens that question and cancels it).
    // Stopped, it connects nowhere and uses none of them.
    admin: true,
    isPublic: false,
    allowedOrigins: [],
    limits: null,
    load: [],
  },
];

const DAY = 24 * HOUR;
const dayStartUtc = (t) => {
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/**
 * Usage rows as the API stores them: one per agent, model and UTC day. The
 * figures are a fixed function of "days ago", so two runs on the same day
 * write the same rows.
 */
function usageRows(agentId, now, { days, emptyDaysAgo, secondModelEvery }) {
  const [main, second] = EXTRA.usage.models;
  const rows = [];
  for (let ago = 0; ago < days; ago++) {
    if (emptyDaysAgo.includes(ago)) continue;
    const date = dayStartUtc(now - ago * DAY);
    rows.push({
      agentId,
      llmCredentialId: EXTRA.llm.primary.id,
      model: main,
      date,
      inputTokens: 40_000 + ((ago * 7919) % 23) * 9_000,
      outputTokens: 1_500 + ((ago * 104_729) % 17) * 300,
      callCount: 12 + ((ago * 31) % 40),
    });
    if (ago % secondModelEvery === 0) {
      rows.push({
        agentId,
        llmCredentialId: EXTRA.llm.second.id,
        model: second,
        date,
        inputTokens: 8_000 + ((ago * 613) % 11) * 2_000,
        outputTokens: 400 + ((ago * 97) % 7) * 100,
        callCount: 3 + (ago % 9),
      });
    }
  }
  return rows;
}

async function seedCredentials() {
  for (const c of Object.values(EXTRA.llm)) {
    // `apiKey` is a plain column (llm.mapper.ts writes it as given). The value
    // is a marker, not a key: nothing can be called with it.
    const data = {
      provider: c.provider,
      model: c.model,
      fallbackModel: c.fallbackModel,
      label: c.label,
      apiKey: 'limits-e2e-not-a-real-key',
      status: 'active',
      supportsChat: true,
      supportsEmbedding: false,
    };
    await prisma.llmCredential.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
  }
}

async function seedKnowledge() {
  for (const k of EXTRA.knowledge) {
    const data = {
      name: k.name,
      description: 'Fixture base for the Overview browser checks',
      // The API names the workspace after the id (lightrag/data/workspace.ts).
      workspace: `knowledge_${k.id.replace(/-/g, '')}`,
      indexStatus: 'idle',
      // 'done' keeps the one-time transition off the shared pool away from
      // a base that has nothing to move.
      migrationState: 'done',
    };
    await prisma.knowledge.upsert({ where: { id: k.id }, create: { id: k.id, ...data }, update: data });
  }
}

async function seedUsage(now) {
  const sets = [
    usageRows(EXTRA.usage.agentId, now, {
      days: EXTRA.usage.days,
      emptyDaysAgo: EXTRA.usage.emptyDaysAgo,
      secondModelEvery: 3,
    }),
    // A stopped agent still has a past: three days of it.
    usageRows(EXTRA.stopped.id, now, { days: 9, emptyDaysAgo: [0, 1, 2, 4, 5, 7], secondModelEvery: 99 }),
  ];
  // Every fixture agent starts from no usage, so the ones meant to have none
  // stay that way whatever an earlier run wrote.
  await prisma.usage.deleteMany({ where: { agentId: { in: FIXTURES.map((f) => f.id) } } });
  for (const rows of sets) await prisma.usage.createMany({ data: rows });
  return sets.map((rows) => rows.length);
}

async function upsertUser({ email, password }, role) {
  const hash = await bcrypt.hash(password, 10);
  const data = { name: email.split('@')[0], password: hash, role, status: 'active' };
  return prisma.user.upsert({ where: { email }, create: { email, ...data }, update: data });
}

async function main() {
  const now = Date.now();
  const owner = await upsertUser(OWNER, 'Owner');
  await upsertUser(USER, 'User');

  const template = await prisma.template.upsert({
    where: { name: TEMPLATE.name },
    create: TEMPLATE,
    update: { description: TEMPLATE.description },
  });

  // Before the agents: `limits-off` points at the first credential.
  await seedCredentials();
  await seedKnowledge();

  // One agent at most holds the admin tools. A database that already has
  // one outside these fixtures keeps it: nothing else is touched.
  const otherAdmin = await prisma.agent.findFirst({
    where: { isAdmin: true, NOT: { id: { in: FIXTURES.map((f) => f.id) } } },
    select: { id: true },
  });

  for (const f of FIXTURES) {
    const agent = {
      name: f.name,
      isAdmin: Boolean(f.admin) && !otherAdmin,
      templateId: template.id,
      status: f.status ?? 'running',
      statusReason: null,
      workflowId: null,
      isPublic: f.isPublic,
      allowedOrigins: f.allowedOrigins,
      // What the Overview checks edit, back to where they start from.
      llmCredentialId: f.llm ?? null,
      knowledgeIds: [],
      config: {},
      resources: { cpu: '500m', memory: '512Mi' },
      debugEnabled: false,
      // Keeps the pod-less fixture inside the deploy grace window, so the
      // drift sweep does not mark it failed while the checks run.
      lastDeployStartedAt: new Date(now),
      firstDeployedAt: new Date(now),
    };
    await prisma.agent.upsert({ where: { id: f.id }, create: { id: f.id, ...agent }, update: agent });

    await prisma.agentLimit.deleteMany({ where: { agentId: f.id } });
    if (f.limits) {
      await prisma.agentLimit.create({
        data: { agentId: f.id, perMinute: null, perHour: null, perDay: null, ...f.limits, updatedById: owner.id },
      });
    }

    await prisma.agentLoadMinute.deleteMany({ where: { agentId: f.id } });
    for (const row of f.load) {
      await prisma.agentLoadMinute.create({
        data: { agentId: f.id, minute: minuteStart(now - row.ago), accepted: row.accepted },
      });
    }

    await prisma.agentShareLink.deleteMany({ where: { agentId: f.id } });
    if (f.share) {
      await prisma.agentShareLink.create({
        data: {
          agentId: f.id,
          token: `sl_${randomBytes(32).toString('base64url')}`,
          createdBy: owner.id,
          updatedBy: owner.id,
        },
      });
    }
    const limits = f.limits ? JSON.stringify(f.limits) : 'off';
    console.log(`  ${f.name.padEnd(14)} ${f.isPublic ? 'public ' : 'private'} limits ${limits}`);
  }

  const [offRows, stoppedRows] = await seedUsage(now);
  console.log(
    `  usage          ${offRows} rows over ${EXTRA.usage.days} days for limits-off, ${stoppedRows} for ${EXTRA.stopped.name}`,
  );
  console.log(
    `  also           ${Object.keys(EXTRA.llm).length} LLM credentials (dummy keys), ${EXTRA.knowledge.length} knowledge bases`,
  );
  console.log(`seeded ${FIXTURES.length} agents, 2 users (owner, user). Start or restart the API now.`);
}

main()
  .catch((err) => {
    console.error('seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
