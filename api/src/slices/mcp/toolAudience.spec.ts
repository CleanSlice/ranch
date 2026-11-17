/**
 * Every tool has an audience, and the audience decides who may list and call
 * it (CLEAN-232). Without a database: load every `*.tool.ts` under
 * src/slices, read the audience off each `@Tool` method the way
 * McpRegistryService does at boot, and check it three ways.
 *
 *  1. No tool without one. A new tool file, or a new method in an old one,
 *     fails here before it fails to boot.
 *  2. The table is pinned. An audience is a security decision: changing one,
 *     or adding a tool class, shows up as a diff of this file, next to the
 *     console route the tool mirrors.
 *  3. Each audience admits exactly the callers it names, for the six callers
 *     that matter: a guest, a User, an Admin, the Owner, the Ranch admin
 *     agent acting for itself, and a plain agent.
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Request } from 'express';
import { UserRoleTypes } from '#/user/user/domain';
import {
  MCP_TOOL_METADATA_KEY,
  TOOL_AUDIENCES,
  toolAudienceOf,
  type ToolAudienceTypes,
  type ToolMetadata,
} from './decorators';
import { audienceAllows } from './tooling';
import { asGuest, asPerson, asTrustedAgent } from './testing';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  CoreV1Api: class {},
  CustomObjectsApi: class {},
  Log: class {},
  Watch: class {},
}));

const SLICES = join(__dirname, '..');

/**
 * One audience per tool class, by file. `admin` unless the console route
 * says otherwise; the route each one mirrors is named in docs/agent-tools.md.
 */
const CLASS_AUDIENCE: Record<string, ToolAudienceTypes> = {
  'agent/agent/agentAdmin.tool.ts': 'admin',
  'agent/agentChannel/agentChannel.tool.ts': 'admin',
  'agent/event/agentEvent.tool.ts': 'admin',
  'agent/file/file.tool.ts': 'admin',
  'agent/limit/agentLimit.tool.ts': 'admin',
  'agent/peer/askAgent.tool.ts': 'agent',
  'agent/peer/peerAdmin.tool.ts': 'admin',
  'agent/peer/peerSelf.tool.ts': 'agent',
  'agent/secret/secret.tool.ts': 'admin',
  'agent/shareLink/shareLink.tool.ts': 'admin',
  'agent/template/templateAdmin.tool.ts': 'admin',
  'agent/templateInstall/templateInstall.tool.ts': 'admin',
  'bridle/attachment.tool.ts': 'everyone',
  'browser/browser.tool.ts': 'person',
  'chat/chat.tool.ts': 'admin',
  'integration/integration.tool.ts': 'person',
  'llm/llm.tool.ts': 'admin',
  'log/log.tool.ts': 'admin',
  'mcpServer/mcpProbe.tool.ts': 'admin',
  'mcpServer/mcpServer.tool.ts': 'admin',
  'mcpServer/oauth/mcpOauth.tool.ts': 'admin',
  'paddock/evaluation/evaluation.tool.ts': 'admin',
  'paddock/scenario/scenario.tool.ts': 'admin',
  'rancher/rancher.tool.ts': 'admin',
  'reins/knowledge/knowledge.tool.ts': 'everyone',
  'reins/knowledge/knowledgeAdmin.tool.ts': 'admin',
  'reins/knowledge/knowledgeDocuments.tool.ts': 'agent',
  'reins/source/source.tool.ts': 'admin',
  'setting/setting.tool.ts': 'admin',
  'skill/skill.tool.ts': 'admin',
  'upgrade/upgrade.tool.ts': 'admin',
  'usage/usage.tool.ts': 'admin',
  'user/apiKey/apiKey.tool.ts': 'admin',
  'user/user/user.tool.ts': 'admin',
};

/**
 * Tools whose audience differs from their class's: the console route behind
 * each is `@Roles(Owner)` while the rest of its controller admits an Admin.
 */
const METHOD_AUDIENCE: Record<string, ToolAudienceTypes> = {
  set_user_role: 'owner',
  delete_user: 'owner',
  set_notification_destination: 'owner',
  send_test_notification: 'owner',
  remove_notification_destination: 'owner',
};

function toolFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...toolFiles(full));
    } else if (entry.endsWith('.tool.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

interface Discovered {
  file: string;
  className: string;
  method: string;
  name: string;
  /** The method's own audience, else its class's, as the registry reads it. */
  audience: ToolAudienceTypes | undefined;
  classAudience: ToolAudienceTypes | undefined;
}

const loadErrors: string[] = [];
const filesWithoutTools: string[] = [];

function discover(): Discovered[] {
  const found: Discovered[] = [];
  for (const path of toolFiles(SLICES)) {
    const file = relative(SLICES, path).replace(/\\/g, '/');
    let mod: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      mod = require(path) as Record<string, unknown>;
    } catch (e) {
      loadErrors.push(`${file}: ${(e as Error).stack ?? String(e)}`);
      continue;
    }
    const before = found.length;
    for (const [className, exported] of Object.entries(mod)) {
      if (typeof exported !== 'function' || !exported.prototype) continue;
      const proto = exported.prototype as Record<string, unknown>;
      for (const method of Object.getOwnPropertyNames(proto)) {
        if (method === 'constructor') continue;
        // Descriptors, not property reads: a getter on the prototype must
        // not run without `this` (see tool-metadata.spec.ts).
        const ref = Object.getOwnPropertyDescriptor(proto, method)
          ?.value as unknown;
        if (typeof ref !== 'function') continue;
        const metadata = Reflect.getMetadata(MCP_TOOL_METADATA_KEY, ref) as
          | ToolMetadata
          | undefined;
        if (!metadata) continue;
        found.push({
          file,
          className,
          method,
          name: metadata.name,
          audience: toolAudienceOf(exported, ref),
          classAudience: toolAudienceOf(exported, undefined),
        });
      }
    }
    if (found.length === before) filesWithoutTools.push(file);
  }
  return found;
}

// ── the six callers ──────────────────────────────────────────

const ranchAgent = (): Request =>
  ({
    user: { sub: 'agent:ranch', email: '', roles: [UserRoleTypes.Owner] },
  }) as unknown as Request;
const plainAgentToken = (): Request =>
  ({
    user: { sub: 'agent:helper', email: '', roles: [UserRoleTypes.Agent] },
  }) as unknown as Request;

/** Everyone but the last reaches the tool through the Ranch admin agent. */
const CALLERS = {
  guest: () => asGuest(ranchAgent()),
  user: () => asPerson(ranchAgent(), UserRoleTypes.User),
  admin: () => asPerson(ranchAgent(), UserRoleTypes.Admin),
  owner: () => asPerson(ranchAgent(), UserRoleTypes.Owner),
  trustedAgent: () => asTrustedAgent(ranchAgent()),
  plainAgent: () => asTrustedAgent(plainAgentToken()),
} as const;
type CallerNames = keyof typeof CALLERS;

const EXPECTED: Record<ToolAudienceTypes, Record<CallerNames, boolean>> = {
  // prettier-ignore
  everyone: { guest: true, user: true, admin: true, owner: true, trustedAgent: true, plainAgent: true },
  // Token-based on purpose: self-service tools act for the calling agent,
  // whoever it is answering. Every caller here is an agent runtime.
  // prettier-ignore
  agent: { guest: true, user: true, admin: true, owner: true, trustedAgent: true, plainAgent: true },
  // prettier-ignore
  person: { guest: false, user: true, admin: true, owner: true, trustedAgent: false, plainAgent: false },
  // prettier-ignore
  admin: { guest: false, user: false, admin: true, owner: true, trustedAgent: true, plainAgent: false },
  // prettier-ignore
  owner: { guest: false, user: false, admin: false, owner: true, trustedAgent: true, plainAgent: false },
};

describe('every tool declares who it is for (CLEAN-232)', () => {
  const tools = discover();

  it('loads every tool file, and each one holds a tool', () => {
    expect(loadErrors).toEqual([]);
    expect(filesWithoutTools).toEqual([]);
    expect(tools.length).toBeGreaterThan(100);
  });

  it('no tool is without an audience', () => {
    const missing = tools
      .filter((t) => !t.audience)
      .map((t) => `${t.file} ${t.className}.${t.method} (${t.name})`);
    expect(missing).toEqual([]);
  });

  it('every tool class is in the pinned table, with the audience pinned there', () => {
    const actual: Record<string, ToolAudienceTypes | undefined> = {};
    for (const t of tools) actual[t.file] = t.classAudience;
    // A new `*.tool.ts` lands here: decide its audience against the console
    // route it mirrors, then add it to CLASS_AUDIENCE.
    expect(actual).toEqual(CLASS_AUDIENCE);
  });

  it('the only tools that differ from their class are the pinned Owner-only ones', () => {
    const differing: Record<string, ToolAudienceTypes | undefined> = {};
    for (const t of tools) {
      if (t.audience !== t.classAudience) differing[t.name] = t.audience;
    }
    expect(differing).toEqual(METHOD_AUDIENCE);
  });

  it('pins the tools the defect was about', () => {
    const audienceOf = (name: string) =>
      tools.find((t) => t.name === name)?.audience;

    expect(audienceOf('delete_agent')).toBe('admin');
    expect(audienceOf('stop_agent')).toBe('admin');
    expect(audienceOf('create_user')).toBe('admin');
    expect(audienceOf('set_user_role')).toBe('owner');
    expect(audienceOf('delete_user')).toBe('owner');
    expect(audienceOf('upsert_setting')).toBe('admin');
    expect(audienceOf('run_paddock_evaluation')).toBe('admin');
    expect(audienceOf('delete_paddock_scenario')).toBe('admin');
    expect(audienceOf('browser_session_open')).toBe('person');
    expect(audienceOf('delete_integration_account')).toBe('person');
    expect(audienceOf('query_knowledge')).toBe('everyone');
    expect(audienceOf('ask_agent')).toBe('agent');
  });
});

describe('each audience admits exactly the callers it names', () => {
  it.each(TOOL_AUDIENCES)('%s', (audience) => {
    const actual = Object.fromEntries(
      (Object.keys(CALLERS) as CallerNames[]).map((caller) => [
        caller,
        audienceAllows(audience, CALLERS[caller]()),
      ]),
    );
    expect(actual).toEqual(EXPECTED[audience]);
  });

  it('the table covers every audience there is', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...TOOL_AUDIENCES].sort());
  });

  it('a plain agent acting for a proven person gets person tools and nothing above', () => {
    const req = asPerson(plainAgentToken(), UserRoleTypes.Owner);
    expect(audienceAllows('person', req)).toBe(true);
    expect(audienceAllows('admin', req)).toBe(false);
    expect(audienceAllows('owner', req)).toBe(false);
  });

  it('an agent that names nobody is a guest', () => {
    const req = ranchAgent();
    expect(audienceAllows('admin', req)).toBe(false);
    expect(audienceAllows('owner', req)).toBe(false);
    expect(audienceAllows('person', req)).toBe(false);
  });

  it('a person on their own console token is not an agent', () => {
    const owner = {
      user: { sub: 'user-o', email: '', roles: [UserRoleTypes.Owner] },
    } as unknown as Request;
    expect(audienceAllows('agent', owner)).toBe(false);
    expect(audienceAllows('owner', owner)).toBe(true);
  });

  it('an undeclared audience admits nobody', () => {
    for (const caller of Object.values(CALLERS)) {
      expect(audienceAllows(undefined, caller())).toBe(false);
      expect(audienceAllows('root' as never, caller())).toBe(false);
    }
  });
});

describe('every tool, as each caller', () => {
  const tools = discover();

  it.each(Object.keys(CALLERS) as CallerNames[])(
    'what %s may list and call is exactly what its audiences allow',
    (caller) => {
      const may = tools
        .filter((t) => audienceAllows(t.audience, CALLERS[caller]()))
        .map((t) => t.name);
      const expected = tools
        .filter((t) => t.audience && EXPECTED[t.audience][caller])
        .map((t) => t.name);
      expect(may).toEqual(expected);
    },
  );

  it('a guest and a User get no management tool at all', () => {
    for (const caller of ['guest', 'user'] as const) {
      const reached = tools
        .filter((t) => t.audience === 'admin' || t.audience === 'owner')
        .filter((t) => audienceAllows(t.audience, CALLERS[caller]()))
        .map((t) => t.name);
      expect(reached).toEqual([]);
    }
  });

  it('an Admin gets every admin tool and none of the Owner’s', () => {
    const admin = (t: Discovered) =>
      audienceAllows(t.audience, CALLERS.admin());
    expect(tools.filter((t) => t.audience === 'admin').every(admin)).toBe(true);
    expect(tools.filter((t) => t.audience === 'owner').some(admin)).toBe(false);
  });
});
