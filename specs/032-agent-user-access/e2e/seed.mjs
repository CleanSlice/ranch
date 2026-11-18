// Seeds the local database for the acting-party checks (CLEAN-232) and the
// agent-access checks (CLEAN-231).
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
// Agent access, put back to this on every run (CLEAN-231):
//
//   the Admin        limited: allowed access-alpha and access-bravo only
//   the first User   open, with access-alpha denied
//   the second User  open: no row at all, as an account nobody edited
//
// So the Admin reaches neither access-charlie nor the Ranch admin agent, and
// the first User reaches everything but access-alpha. Pins of the four
// accounts are removed.
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
  const owner = await upsertUser(OWNER);
  const admin = await upsertUser(ADMIN_USER);
  const user = await upsertUser(USER);
  const user2 = await upsertUser(USER2);

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

  // Agent access (CLEAN-231). Written directly, like the rest of the
  // fixtures; the routes that edit it are what http.mjs checks.
  const accounts = [owner.id, admin.id, user.id, user2.id];
  await prisma.userAgentAccessEntry.deleteMany({ where: { userId: { in: accounts } } });
  await prisma.userAgentAccess.deleteMany({ where: { userId: { in: accounts } } });
  await prisma.agentPin.deleteMany({ where: { userId: { in: accounts } } });
  await prisma.userAgentAccess.create({ data: { userId: admin.id, limited: true } });
  await prisma.userAgentAccessEntry.createMany({
    data: [
      { userId: admin.id, agentId: AGENTS.a.id, list: 'allowed' },
      { userId: admin.id, agentId: AGENTS.b.id, list: 'allowed' },
    ],
  });
  await prisma.userAgentAccess.create({ data: { userId: user.id, limited: false } });
  await prisma.userAgentAccessEntry.create({ data: { userId: user.id, agentId: AGENTS.a.id, list: 'denied' } });
  // Something for a list to leave out (http.mjs): one day of usage per
  // ordinary agent, one conversation on the shared `admin` channel of each,
  // and the first User's own conversation with access-alpha, which that
  // User's lists now hide. Upserted, so a second run changes nothing.
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (const key of ['a', 'b', 'c']) {
    const agentId = AGENTS[key].id;
    const usage = { agentId, llmCredentialId: LLM.id, model: LLM.model, date: day, inputTokens: 1000, outputTokens: 100, callCount: 3 };
    await prisma.usage.upsert({
      where: { agentId_model_date: { agentId, model: LLM.model, date: day } },
      create: usage,
      update: usage,
    });
    const chat = {
      agentId,
      channel: 'bridle',
      externalUserId: 'admin',
      sessionKey: 'bridle:admin',
      title: `e2e ${AGENTS[key].name}`,
      preview: `fixture conversation with ${AGENTS[key].name}`,
      lastRole: 'assistant',
      lastMessageAt: now,
      messageCount: 2,
      userMessageCount: 1,
      archived: false,
    };
    // By the table's own key: a conversation somebody really had on that
    // channel is the row, and is left with its id.
    await prisma.chatSession.upsert({
      where: { agentId_sessionKey: { agentId, sessionKey: chat.sessionKey } },
      create: chat,
      update: { archived: false, lastMessageAt: now },
    });
  }
  const own = {
    agentId: AGENTS.a.id,
    channel: 'bridle',
    externalUserId: user.id,
    sessionKey: `bridle:${user.id}`,
    title: 'e2e the User with access-alpha',
    preview: 'fixture conversation of the first User with access-alpha',
    lastRole: 'assistant',
    lastMessageAt: now,
    messageCount: 2,
    userMessageCount: 1,
    archived: false,
  };
  await prisma.chatSession.upsert({
    where: { agentId_sessionKey: { agentId: own.agentId, sessionKey: own.sessionKey } },
    create: own,
    update: { archived: false, lastMessageAt: now },
  });

  console.log('  access: the Admin limited to access-alpha and access-bravo; the first User denied access-alpha; the second User open');

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
