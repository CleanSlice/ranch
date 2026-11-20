/**
 * What the assistant offers each role at each level, over the real tool set
 * (CLEAN-240, SC-006). Loads every `*.tool.ts` the way the boot check does
 * and asks the same service the tool policy asks. A tool added tomorrow is
 * placed by its area, effect and audience; this file notices when that
 * placement gives a level something it must not hold.
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  MCP_TOOL_METADATA_KEY,
  toolAudienceOf,
  type ToolAudienceTypes,
  type ToolMetadata,
} from './decorators';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import { AssistantAccessService } from '#/user/assistantAccess/domain/assistantAccess.service';
import type { AssistantLevel } from '#/user/assistantAccess/domain/assistantLevels';
import type { AssistantRole } from '#/user/assistantAccess/domain/assistantAccess.types';

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

function toolFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...toolFiles(full));
    } else if (entry.endsWith('.tool.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

interface IRealTool {
  metadata: ToolMetadata;
  audience: ToolAudienceTypes | undefined;
}

function discover(): IRealTool[] {
  const found: IRealTool[] = [];
  for (const file of toolFiles(SLICES)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || !exported.prototype) continue;
      const proto = exported.prototype as Record<string, unknown>;
      for (const method of Object.getOwnPropertyNames(proto)) {
        if (method === 'constructor') continue;
        const ref = Object.getOwnPropertyDescriptor(proto, method)
          ?.value as unknown;
        if (typeof ref !== 'function') continue;
        const metadata = Reflect.getMetadata(MCP_TOOL_METADATA_KEY, ref) as
          | ToolMetadata
          | undefined;
        if (!metadata) continue;
        found.push({
          metadata,
          audience: toolAudienceOf(exported as never, ref),
        });
      }
    }
  }
  return found;
}

const tools = discover();
const byName = new Map(tools.map((t) => [t.metadata.name, t]));

/** What a role is offered at a level, by the service the tool policy asks. */
const grantOf = async (role: AssistantRole, level: AssistantLevel) => {
  const row = {
    enabled: true,
    level,
    custom: null,
    updatedById: null,
    updatedAt: null,
  };
  const service = new AssistantAccessService(
    { findAccount: async () => null, findRole: async () => row } as never,
    {} as never,
    {} as never,
    { getTools: () => tools } as never,
  );
  const grant = await service.grantFor({ kind: 'person', userId: 'u', role });
  return new Set(grant.names ?? []);
};

const ADMIN = UserRoleTypes.Admin as AssistantRole;
const USER = UserRoleTypes.User as AssistantRole;

describe('the assistant’s levels over the real tools', () => {
  it('finds the tool set', () => {
    expect(tools.length).toBeGreaterThan(100);
  });

  // One named ability per area: [tool, Admin basic, standard, full, User basic, standard, full]
  it.each([
    ['list_agents', true, true, true, true, true, true],
    ['pin_agent', true, true, true, true, true, true],
    ['restart_agent', false, true, true, false, true, true],
    ['delete_agent', false, true, true, false, true, true],
    ['write_agent_file', false, true, true, false, true, true],
    ['connect_agent_peer', false, true, true, false, true, true],
    ['list_knowledges', true, true, true, false, false, false],
    ['create_knowledge', false, true, true, false, false, false],
    ['create_skill', false, true, true, false, false, false],
    ['run_paddock_evaluation', false, true, true, false, false, false],
    ['list_templates', true, true, true, false, false, false],
    ['update_template', false, false, true, false, false, false],
    ['list_llms', true, true, true, false, false, false],
    ['create_llm', false, false, true, false, false, false],
    ['register_mcp_server', false, false, true, false, false, false],
    ['list_users', true, true, true, false, false, false],
    ['create_user', false, false, true, false, false, false],
    ['set_user_agent_access', false, false, true, false, false, false],
    ['upsert_setting', false, false, true, false, false, false],
    ['run_upgrade', false, false, true, false, false, false],
    ['list_chats', true, true, true, false, false, false],
    // The Owner's alone at every level.
    ['delete_user', false, false, false, false, false, false],
    ['set_user_role', false, false, false, false, false, false],
    ['set_agent_admin', false, false, false, false, false, false],
  ])('%s', async (name, ab, as, af, ub, us, uf) => {
    expect(byName.has(name)).toBe(true);
    const got = [
      (await grantOf(ADMIN, 'basic')).has(name),
      (await grantOf(ADMIN, 'standard')).has(name),
      (await grantOf(ADMIN, 'full')).has(name),
      (await grantOf(USER, 'basic')).has(name),
      (await grantOf(USER, 'standard')).has(name),
      (await grantOf(USER, 'full')).has(name),
    ];
    expect(got).toEqual([ab, as, af, ub, us, uf]);
  });

  it('each level holds the one below it', async () => {
    for (const role of [ADMIN, USER]) {
      const basic = await grantOf(role, 'basic');
      const standard = await grantOf(role, 'standard');
      const full = await grantOf(role, 'full');
      expect([...basic].every((n) => standard.has(n))).toBe(true);
      expect([...standard].every((n) => full.has(n))).toBe(true);
    }
  });

  it('a User never gets a tool of the admin or owner audience', async () => {
    const full = await grantOf(USER, 'full');
    const above = [...full].filter((n) =>
      ['admin', 'owner'].includes(byName.get(n)!.audience ?? ''),
    );
    expect(above).toEqual([]);
  });

  it('nobody but the Owner gets an owner tool', async () => {
    const full = await grantOf(ADMIN, 'full');
    expect(
      [...full].filter((n) => byName.get(n)!.audience === 'owner'),
    ).toEqual([]);
  });

  // "See and ask": outside what is personal to the person, Basic writes
  // nothing. A write filed as a read would show up in the boot check; a
  // personal tool that reaches beyond the person would show up here.
  it('Basic holds no write outside the person audience', async () => {
    const basic = await grantOf(ADMIN, 'basic');
    const writes = [...basic].filter((n) => {
      const tool = byName.get(n)!;
      return tool.metadata.effect === 'write' && tool.audience !== 'person';
    });
    expect(writes).toEqual([]);
  });

  it('Basic holds nothing destructive that is not the person’s own', async () => {
    const basic = await grantOf(ADMIN, 'basic');
    const destructive = [...basic].filter((n) => {
      const tool = byName.get(n)!;
      return tool.metadata.destructive && tool.audience !== 'person';
    });
    expect(destructive).toEqual([]);
  });

  it('no level is read as holding what the assistant needs to talk at all', async () => {
    const full = await grantOf(ADMIN, 'full');
    const own = [...full].filter((n) =>
      ['everyone', 'agent'].includes(byName.get(n)!.audience ?? ''),
    );
    expect(own).toEqual([]);
  });
});
