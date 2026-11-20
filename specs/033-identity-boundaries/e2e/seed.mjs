// CLEAN-236 scenarios: the people, the agents and their access lists
// (quickstart.md §2). Idempotent. `fresh()` empties the connections, which
// is how every scenario starts.
import { api, prisma, API, jwt, JWT_SECRET, check } from './lib.mjs';

/** Throwaway: these accounts exist in the scratch database only. */
const PASSWORD = 'e2e-Passw0rd!';

export const AGENTS = {
  /** Public: an anonymous visitor may talk to it. */
  A: { id: 'agent-aaaaaaaa-0000-4000-8000-000000000001', name: 'Front Desk', isPublic: true },
  B: { id: 'agent-bbbbbbbb-0000-4000-8000-000000000002', name: 'Back Office' },
  C: { id: 'agent-cccccccc-0000-4000-8000-000000000003', name: 'Archive' },
  /** The Ranch admin agent: only the Owner manages it. */
  R: { id: 'agent-dddddddd-0000-4000-8000-000000000004', name: 'Rancher', isAdmin: true },
};
export const GHOST = 'agent-eeeeeeee-0000-4000-8000-000000000009';

const ACCOUNTS = {
  owner: { name: 'Olga Owner', email: 'owner@e2e.test', role: 'Owner' },
  /** Reaches A and C, is denied B. */
  admin: { name: 'Adam Admin', email: 'admin@e2e.test', role: 'Admin' },
  /** Reaches A, B and C. */
  u1: { name: 'Uma One', email: 'u1@e2e.test', role: 'User' },
  /** Reaches A only. */
  u2: { name: 'Ugo Two', email: 'u2@e2e.test', role: 'User' },
};

export async function login(email, opts = {}) {
  const res = await api('POST', '/auth/login', {
    body: { email, password: PASSWORD },
    ...opts,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login ${email}: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.data;
}

/** The bearer an agent's runtime holds (`issueAgentServiceToken`). */
export function agentToken(agent) {
  return jwt.sign(
    {
      sub: `agent:${agent.id}`,
      email: `agent-${agent.id}@ranch.local`,
      roles: [agent.isAdmin ? 'Owner' : 'Agent'],
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

async function setAccess(ownerToken, userId, allowed, denied) {
  const route = `/users/${userId}/agent-access`;
  const now = await api('GET', route, { token: ownerToken });
  const res = await api('PUT', route, {
    token: ownerToken,
    body: { allowed, denied, version: now.data?.version ?? null, confirmOpen: true },
  });
  if (res.status !== 200) throw new Error(`access of ${userId}: ${res.status} ${res.text}`);
}

/** Connections and their history, gone. */
export async function fresh() {
  const db = prisma();
  await db.$executeRawUnsafe('DELETE FROM "AgentDelegation"');
  await db.$executeRawUnsafe('DELETE FROM "AgentPeer"');
}

export async function seed() {
  const init = await api('POST', '/setup/init', {
    body: { name: ACCOUNTS.owner.name, email: ACCOUNTS.owner.email, password: PASSWORD },
  });
  const ownerToken =
    init.data?.accessToken ?? (await login(ACCOUNTS.owner.email)).accessToken;

  for (const key of ['admin', 'u1', 'u2']) {
    const a = ACCOUNTS[key];
    await api('POST', '/users', {
      token: ownerToken,
      body: { name: a.name, email: a.email, password: PASSWORD, role: a.role },
    });
  }
  const users = (await api('GET', '/users', { token: ownerToken })).data;
  const people = {};
  for (const [key, a] of Object.entries(ACCOUNTS)) {
    const row = users.find((u) => u.email === a.email);
    if (!row) throw new Error(`no account ${a.email}`);
    people[key] = {
      ...a,
      id: row.id,
      token: key === 'owner' ? ownerToken : (await login(a.email)).accessToken,
    };
  }

  // Bare agent rows: no template, no deployment. The scenarios bring their
  // own runtime (`fakeRuntime.mjs`).
  const db = prisma();
  await fresh();
  await db.$transaction([
    db.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
    ...Object.values(AGENTS).map((a) =>
      db.$executeRawUnsafe(
        `INSERT INTO "Agent" (id, name, "templateId", "updatedAt", "isAdmin", "isPublic", status)
         VALUES ($1, $2, 'tpl-e2e', now(), $3, $4, 'running')
         ON CONFLICT (id) DO UPDATE SET name = $2, "isAdmin" = $3, "isPublic" = $4, status = 'running'`,
        a.id,
        a.name,
        a.isAdmin === true,
        a.isPublic === true,
      ),
    ),
  ]);

  // Where the API believes it is reachable: a connection to one of its own
  // agents is called at this address.
  await api('PUT', '/settings/integrations/ranch_api_url', {
    token: ownerToken,
    body: { valueType: 'string', value: API },
  });

  const { A, B, C } = AGENTS;
  await setAccess(ownerToken, people.admin.id, [], [B.id]);
  await setAccess(ownerToken, people.u1.id, [A.id, B.id, C.id], []);
  await setAccess(ownerToken, people.u2.id, [A.id], []);
  return people;
}

/** Connect `from` → `to` as a person; returns the connection id. */
export async function connect(token, from, to) {
  const res = await api('POST', `/agents/${from.id}/peers`, {
    token,
    body: { peerAgentId: to.id },
  });
  if (!res.data?.id) throw new Error(`connect ${from.name}→${to.name}: ${res.status} ${res.text}`);
  return res.data.id;
}

export async function openToVisitors(token, from, peerId, open = true) {
  const res = await api('PUT', `/agents/${from.id}/peers/${peerId}/visitors`, {
    token,
    body: open ? { open: true, confirm: true } : { open: false },
  });
  check(`${open ? 'open' : 'close'} ${from.name}'s connection to visitors`, res.status, 200);
}
