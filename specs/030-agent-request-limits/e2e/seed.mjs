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
import { AGENTS, OWNER, USER, apiEnv, requireFromApi } from './lib.mjs';
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
  { id: AGENTS.off, name: 'limits-off', isPublic: false, allowedOrigins: [], limits: null, load: [] },
  // Public with no limits: only possible for an agent saved before limits
  // existed, which is exactly what writing the row directly reproduces.
  { id: AGENTS.legacy, name: 'limits-legacy', isPublic: true, allowedOrigins: [], limits: null, load: [] },
  { id: AGENTS.share, name: 'limits-share', isPublic: false, allowedOrigins: [], limits: null, load: [], share: true },
];

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

  for (const f of FIXTURES) {
    const agent = {
      name: f.name,
      templateId: template.id,
      status: 'running',
      statusReason: null,
      isPublic: f.isPublic,
      allowedOrigins: f.allowedOrigins,
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
  console.log(`seeded ${FIXTURES.length} agents, 2 users (owner, user). Start or restart the API now.`);
}

main()
  .catch((err) => {
    console.error('seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
