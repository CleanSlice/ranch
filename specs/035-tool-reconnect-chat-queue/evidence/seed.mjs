// CLEAN-245 evidence: the people and the agents. Idempotent.
import { api, prisma } from "./lib.mjs";

/** Throwaway: these accounts exist in the scratch database only. */
export const PASSWORD = "e2e-Passw0rd!";

export const AGENTS = {
  /** Public, shared by link: the one every screenshot is taken on. */
  A: {
    id: "agent-aaaaaaaa-0000-4000-8000-000000000245",
    name: "Front Desk",
    isPublic: true,
  },
  /** A second one, so a list has more than one row. */
  B: { id: "agent-bbbbbbbb-0000-4000-8000-000000000245", name: "Back Office" },
  /** The Ranch admin agent. */
  R: {
    id: "agent-dddddddd-0000-4000-8000-000000000245",
    name: "Rancher",
    isAdmin: true,
  },
};

export const ACCOUNTS = {
  owner: { name: "Olga Owner", email: "owner@e2e.test", role: "Owner" },
  user: { name: "Uma User", email: "user@e2e.test", role: "User" },
};

export async function login(email) {
  const res = await api("POST", "/auth/login", {
    body: { email, password: PASSWORD },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login ${email}: ${res.status}`);
  }
  return res.data;
}

/** An agent's row status: what a restart, a failure or a stop looks like to the consoles. */
export async function setStatus(agent, status) {
  await prisma().$executeRawUnsafe(
    'UPDATE "Agent" SET status = $2, "updatedAt" = now() WHERE id = $1',
    agent.id,
    status,
  );
}

export async function seed() {
  const o = ACCOUNTS.owner;
  const init = await api("POST", "/setup/init", {
    body: { name: o.name, email: o.email, password: PASSWORD },
  });
  const ownerToken =
    init.data?.accessToken ?? (await login(o.email)).accessToken;

  const u = ACCOUNTS.user;
  await api("POST", "/users", {
    token: ownerToken,
    body: { name: u.name, email: u.email, password: PASSWORD, role: u.role },
  });
  const users = (await api("GET", "/users", { token: ownerToken })).data;
  const userRow = users.find((row) => row.email === u.email);
  if (!userRow) throw new Error(`no account ${u.email}`);

  // Bare agent rows: no template, no deployment. `runtime.mjs` is their runtime.
  const db = prisma();
  await db.$transaction([
    db.$executeRawUnsafe("SET LOCAL session_replication_role = replica"),
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

  // The User reaches Front Desk only.
  const route = `/users/${userRow.id}/agent-access`;
  const now = await api("GET", route, { token: ownerToken });
  const access = await api("PUT", route, {
    token: ownerToken,
    body: {
      allowed: [AGENTS.A.id],
      denied: [],
      version: now.data?.version ?? null,
      confirmOpen: true,
    },
  });
  if (access.status !== 200) throw new Error(`access: ${access.status}`);

  // The visitor's way in.
  const share = await api("POST", `/agents/${AGENTS.A.id}/share-link`, {
    token: ownerToken,
  });
  if (!share.data?.token) throw new Error(`share link: ${share.status}`);

  return { ownerToken, userId: userRow.id, shareToken: share.data.token };
}
