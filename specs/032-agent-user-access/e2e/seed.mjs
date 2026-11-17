// Seeds the local database for the acting-party checks (CLEAN-232).
//
//   node specs/032-agent-user-access/e2e/seed.mjs
//
// Idempotent: every row is upserted, nothing else is deleted. One thing IS
// changed outside the fixtures: any other agent that holds the Ranch admin
// flag loses it, because the checks need exactly one Ranch admin agent and
// the API keeps that invariant itself (a local fixture database only).
//
// Writes: an Owner, an Admin, two Users; a template; one LLM credential with
// a dummy key; the Ranch admin agent and three ordinary agents:
//
//   access-alpha    created by the Admin
//   access-bravo    nobody recorded
//   access-charlie  created by the first User. Written directly: no route
//                   lets a User create an agent yet, and the rule that the
//                   creator manages their agent is proven ahead of it.
//
// Reads DATABASE_URL from api/.env; prints no secrets.
import { ADMIN_USER, AGENTS, LLM, OWNER, TEMPLATE, USER, USER2, apiEnv, requireFromApi } from './lib.mjs';

if (!apiEnv.DATABASE_URL) {
  console.error('DATABASE_URL is missing in api/.env');
  process.exit(1);
}
process.env.DATABASE_URL = apiEnv.DATABASE_URL;

const { PrismaClient } = requireFromApi('@prisma/client');
const bcrypt = requireFromApi('bcrypt');
const prisma = new PrismaClient();

async function upsertUser({ email, password, role }) {
  const hash = await bcrypt.hash(password, 10);
  const data = { name: email.split('@')[0], password: hash, role, status: 'active' };
  return prisma.user.upsert({ where: { email }, create: { email, ...data }, update: data });
}

async function main() {
  const now = new Date();
  await upsertUser(OWNER);
  const admin = await upsertUser(ADMIN_USER);
  const user = await upsertUser(USER);
  await upsertUser(USER2);

  const template = await prisma.template.upsert({
    where: { name: TEMPLATE.name },
    create: TEMPLATE,
    update: { description: TEMPLATE.description },
  });

  // `apiKey` is a plain column. The value is a marker, not a key: nothing can
  // be called with it.
  const llm = {
    provider: LLM.provider,
    model: LLM.model,
    label: LLM.label,
    apiKey: 'access-e2e-not-a-real-key',
    status: 'active',
    supportsChat: true,
    supportsEmbedding: false,
  };
  await prisma.llmCredential.upsert({ where: { id: LLM.id }, create: { id: LLM.id, ...llm }, update: llm });

  // Exactly one Ranch admin agent afterwards: ours.
  const demoted = await prisma.agent.updateMany({
    where: { isAdmin: true, NOT: { id: AGENTS.ranch.id } },
    data: { isAdmin: false },
  });

  const rows = [
    { ...AGENTS.ranch, isAdmin: true, createdById: null },
    { ...AGENTS.a, isAdmin: false, createdById: admin.id },
    { ...AGENTS.b, isAdmin: false, createdById: null },
    { ...AGENTS.c, isAdmin: false, createdById: user.id },
  ];
  for (const row of rows) {
    const agent = {
      name: row.name,
      isAdmin: row.isAdmin,
      // Set here and nowhere else: the API never rewrites a creator.
      createdById: row.createdById,
      templateId: template.id,
      llmCredentialId: LLM.id,
      status: 'running',
      statusReason: null,
      workflowId: null,
      isPublic: false,
      allowedOrigins: [],
      knowledgeIds: [],
      // Something for a reader NOT to be shown (GET /agents, see routes.mjs).
      config: { e2eOperatorNote: `operator-only-${row.name}` },
      resources: { cpu: '500m', memory: '512Mi' },
      debugEnabled: false,
      pinned: false,
      // Keeps the pod-less fixture inside the deploy grace window, so the
      // drift sweep does not mark it failed while the checks run.
      lastDeployStartedAt: now,
      firstDeployedAt: now,
    };
    await prisma.agent.upsert({ where: { id: row.id }, create: { id: row.id, ...agent }, update: agent });
    const creator =
      row.createdById === admin.id ? 'the Admin' : row.createdById === user.id ? 'the User' : 'nobody';
    console.log(`  ${row.name.padEnd(15)} ${row.isAdmin ? 'Ranch admin agent' : 'ordinary'.padEnd(17)} created by ${creator}`);
  }

  // A connection a check may have made, back to none.
  const ids = rows.map((r) => r.id);
  await prisma.agentPeer.deleteMany({ where: { agentId: { in: ids } } });

  const admins = await prisma.agent.count({ where: { isAdmin: true } });
  if (admins !== 1) throw new Error(`expected exactly one Ranch admin agent, found ${admins}`);
  console.log(
    `seeded 4 agents, 4 accounts (owner, admin, two users), 1 template, 1 LLM credential (dummy key).` +
      (demoted.count ? ` ${demoted.count} other agent(s) lost the Ranch admin flag.` : ''),
  );
}

main()
  .catch((err) => {
    console.error('seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
