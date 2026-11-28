/**
 * The Ranch assistant is deployed from the settings the Owner approved, not
 * from the live ones (CLEAN-271).
 *
 * An Admin runs the installation from the Settings pages and keeps doing
 * so. Several of those settings decide what the assistant loads and where
 * its token goes: the bucket its workspace is pulled from, the address its
 * pod calls the API at with its Owner token, the address its manifest is
 * posted to. Whoever changes one of them reaches the assistant at its next
 * restart, and through it everything else.
 *
 * This spec holds the mechanism to five things:
 *
 *  (a) an Admin changes each such setting, through the real route and the
 *      real tool; the assistant's next pod, assembled by the code a restart
 *      runs, is byte-identical to before, and an ordinary agent's picks the
 *      change up;
 *  (b) the Owner changes one: both pick it up;
 *  (c) "apply current settings to the assistant" moves the approved values,
 *      and is the Owner's alone;
 *  (d) the drift is told to the Owner by key, never with a value;
 *  (e) settings have ONE reader. A file that reads the settings table
 *      itself, or a deploy that reads a group the assistant is not served
 *      the approved values of, fails here.
 *
 * Nothing of the mechanism is stubbed: `SettingGateway`, `SettingMapper`,
 * `InfraConfigGateway`, `AssistantSettingService`, `SettingController`, the
 * two setting tools, `AgentDeployService`, `WorkflowService` and
 * `ArgoWorkflowGateway` are the real classes. Only the database is a map.
 */
import 'reflect-metadata';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { lastValueFrom, of, defer } from 'rxjs';
import { asPerson, asTrustedAgent } from '#/mcp/testing';
import { RancherTool } from '#/rancher/rancher.tool';
import { RancherController } from '#/rancher/rancher.controller';
import { InfraConfigGateway } from '#/setting/data/infraConfig.gateway';
import { SettingGateway } from '#/setting/data/setting.gateway';
import { SettingMapper } from '#/setting/data/setting.mapper';
import {
  SETTING_CATALOG,
  onUndeclaredSettingRead,
  servingAgentId,
  servingAssistant,
  settingScopeState,
  withLiveSettings,
  type ISettingData,
} from '#/setting/domain';
import { SettingController } from '#/setting/setting.controller';
import { SettingTool } from '#/setting/setting.tool';
import {
  ADMIN,
  OWNER,
  openAccess,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { appRoutes } from '#/user/auth/guards/__fixtures__/routeTable';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { AssistantSettingController } from '../assistantSetting.controller';
import { AssistantSettingInterceptor } from '../assistantSetting.interceptor';
import { AssistantSettingTool } from '../assistantSetting.tool';
import { ALPHA, RANCH, ranchWorld } from './__fixtures__/ranchWorld';
import {
  APPROVED_SETTING_GROUPS,
  AssistantSettingService,
} from './assistantSetting.service';

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

// ── The database: two tables held in maps ────────────────────

interface IRow {
  id: string;
  group: string;
  name: string;
  valueType: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}
interface IPin {
  group: string;
  name: string;
  present: boolean;
  valueType: string;
  value: string;
  changedById: string | null;
  changedAt: Date;
}
const keyOf = (w: { group: string; name: string }) => `${w.group}.${w.name}`;
const AT = new Date('2026-11-27T10:00:00.000Z');
/** Each write is a second later than the one before it. */
let ticks = 0;
const now = () => new Date(AT.getTime() + (ticks += 1) * 1000);

const db = {
  settings: new Map<string, IRow>(),
  pins: new Map<string, IPin>(),
  /** Every key read from the settings table, in order. */
  reads: [] as string[],
};

interface ITables {
  settings: Map<string, IRow>;
  pins: Map<string, IPin>;
}

/**
 * What the spec does to the database while a read is on its way, to put a
 * write exactly where it would hurt.
 */
const meanwhile = {
  /** Before the n-th snapshot read (1-based) begins. */
  beforeSnapshot: null as ((n: number) => Promise<void>) | null,
  /** Inside a snapshot read, once it has been taken. */
  insideSnapshot: null as ((n: number) => Promise<void>) | null,
  snapshots: 0,
  /** The isolation level each transaction asked for. */
  asked: [] as (string | undefined)[],
};

/** The two tables as a client reads and writes them. */
const clientOver = (at: ITables) => ({
  setting: {
    findMany: (args?: { where?: { group?: string } }) => {
      db.reads.push(args?.where?.group ? `${args.where.group}.*` : '*');
      return Promise.resolve(
        [...at.settings.values()]
          .filter(
            (row) => !args?.where?.group || row.group === args.where.group,
          )
          .sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
      );
    },
    findUnique: (args: {
      where: { group_name: { group: string; name: string } };
    }) => {
      db.reads.push(keyOf(args.where.group_name));
      return Promise.resolve(
        at.settings.get(keyOf(args.where.group_name)) ?? null,
      );
    },
    upsert: (args: {
      where: { group_name: { group: string; name: string } };
      create: {
        id: string;
        group: string;
        name: string;
        valueType: string;
        value: string;
      };
      update: { valueType: string; value: string };
    }) => {
      const key = keyOf(args.where.group_name);
      const existing = at.settings.get(key);
      const row: IRow = existing
        ? { ...existing, ...args.update, updatedAt: now() }
        : { ...args.create, createdAt: AT, updatedAt: now() };
      at.settings.set(key, row);
      return Promise.resolve(row);
    },
    delete: (args: {
      where: { group_name: { group: string; name: string } };
    }) => {
      const key = keyOf(args.where.group_name);
      const row = at.settings.get(key);
      if (!row)
        return Promise.reject(new Error('Record to delete does not exist.'));
      at.settings.delete(key);
      return Promise.resolve(row);
    },
  },
  assistantSettingPin: {
    findMany: () =>
      Promise.resolve(
        [...at.pins.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b))),
      ),
    findUnique: (args: {
      where: { group_name: { group: string; name: string } };
    }) => Promise.resolve(at.pins.get(keyOf(args.where.group_name)) ?? null),
    create: (args: { data: Omit<IPin, 'changedAt'> }) => {
      const pin = { ...args.data, changedAt: now() };
      at.pins.set(keyOf(pin), pin);
      return Promise.resolve(pin);
    },
    deleteMany: (args?: {
      where?: { group: string; name: string; changedAt?: Date };
    }) => {
      const before = at.pins.size;
      const where = args?.where;
      if (!where) at.pins.clear();
      else {
        const pin = at.pins.get(keyOf(where));
        if (pin && (!where.changedAt || +where.changedAt === +pin.changedAt)) {
          at.pins.delete(keyOf(where));
        }
      }
      return Promise.resolve({ count: before - at.pins.size });
    },
  },
});

const prisma = {
  ...clientOver(db),
  /**
   * A transaction at REPEATABLE READ reads ONE snapshot, as Postgres gives
   * it: the tables as they stood when it began, whatever is written while
   * it runs. Any other transaction runs on the tables themselves.
   */
  $transaction: async <T>(
    run: (tx: unknown) => Promise<T>,
    options?: { isolationLevel?: string },
  ): Promise<T> => {
    meanwhile.asked.push(options?.isolationLevel);
    if (options?.isolationLevel !== 'RepeatableRead') return run(prisma);
    const n = (meanwhile.snapshots += 1);
    await meanwhile.beforeSnapshot?.(n);
    const snapshot = clientOver({
      settings: new Map(db.settings),
      pins: new Map(db.pins),
    });
    await meanwhile.insideSnapshot?.(n);
    return run(snapshot);
  },
};

// ── The real classes over it ─────────────────────────────────

const gateway = new SettingGateway(prisma as never, new SettingMapper());
const infraConfig = new InfraConfigGateway(gateway, {
  get: () => undefined,
} as never);
const world = ranchWorld({ settings: gateway, infraConfig });
const service = new AssistantSettingService(
  prisma as never,
  gateway,
  world.agents,
);
service.onModuleInit();

const users = {
  findById: (id: string) =>
    Promise.resolve(
      id === ADMIN.id
        ? { id, name: 'Ada Admin', email: 'ada@ranch.test' }
        : null,
    ),
};
const settingsController = new SettingController(gateway, infraConfig);
const driftController = new AssistantSettingController(service, users as never);
const driftTool = new AssistantSettingTool(service);
const settingTool = new SettingTool(gateway, infraConfig);
const access = openAccess();
const permission = new AgentPermissionService(world.agents, access);
const unused = <T>(name: string): T =>
  new Proxy(
    {},
    {
      get: (_t, property) => {
        if (property === 'then') return undefined;
        return () => {
          throw new Error(`${name}.${String(property)} was reached`);
        };
      },
    },
  ) as T;
const rancherService = {
  getStatus: async () => ({
    hasLlm: true,
    hasS3: true,
    template: null,
    admin: await world.agents.findAdmin(),
  }),
};
const rancherTool = new RancherTool(
  world.agents,
  unused('agentDeploy'),
  world.templates,
  world.templateFiles,
  world.llms,
  world.skills,
  gateway,
  unused('usage'),
  unused('files'),
  rancherService as never,
  permission,
  access,
  { pinnedIds: () => Promise.resolve(new Set<string>()) } as never,
);
const rancherController = new RancherController(
  rancherService as never,
  access,
  permission,
);

type Who = { id: string; role: UserRoleTypes };
const http = (who: Who) =>
  ({
    user: { sub: who.id, email: '', roles: [who.role] },
  }) as unknown as Request & { user?: IAuthTokenPayload };
/** The assistant's runtime answering `who`, as the MCP handler marks a call. */
const viaAssistant = (who: Who) =>
  asPerson(
    {
      user: { sub: `agent:${RANCH}`, email: '', roles: [UserRoleTypes.Owner] },
    } as unknown as Request,
    who.role,
    who.id,
  );
const text = (result: unknown) =>
  (result as { content: { text: string }[] }).content[0].text;

const set = (group: string, name: string, value: string) =>
  db.settings.set(`${group}.${name}`, {
    id: `setting-${group}-${name}`,
    group,
    name,
    valueType: 'string',
    value,
    createdAt: AT,
    updatedAt: AT,
  });

/** The settings as the Owner left them. */
function approvedState(): void {
  db.settings.clear();
  db.pins.clear();
  for (const def of SETTING_CATALOG) {
    if (!APPROVED_SETTING_GROUPS.includes(def.group)) continue;
    set(def.group, def.name, `approved-${def.group}-${def.name}`);
  }
  // Values the code parses rather than passes on.
  set('knowledge', 'enabled', 'true');
  set('infrastructure', 'workflow_provider', 'argo');
  set('infrastructure', 'kube_skip_tls_verify', 'false');
  set('integrations', 'aws_secret_access_key', 'APPROVED-SECRET-KEY');
  set('integrations', 'bridle_api_key', 'APPROVED-HUB-KEY');
  set('organization', 'name', 'Acme');
  set('rancher', 'seeded_hash', 'hash-1');
}

beforeEach(() => {
  world.reset();
  approvedState();
  infraConfig.invalidate();
  db.reads.length = 0;
  onUndeclaredSettingRead(null);
  meanwhile.beforeSnapshot = null;
  meanwhile.insideSnapshot = null;
  meanwhile.snapshots = 0;
  meanwhile.asked.length = 0;
});

/** Every catalogued setting of the groups the assistant is served. */
const SERVED = SETTING_CATALOG.filter((def) =>
  APPROVED_SETTING_GROUPS.includes(def.group),
).map((def) => [def.group, def.name] as const);

/** The ones a pod's manifest is built from: an ordinary agent's shows them. */
const IN_EVERY_POD = new Set([
  'integrations.bridle_url',
  'integrations.bridle_api_key',
  'integrations.s3_bucket',
  // Not `s3_endpoint`: a pod is given `s3_endpoint_agent` when that is set.
  'integrations.s3_endpoint_agent',
  'integrations.aws_region',
  'integrations.aws_access_key_id',
  'integrations.aws_secret_access_key',
  'integrations.secret_provider',
  'integrations.aws_secret_prefix',
  'integrations.ranch_api_url',
  'infrastructure.argo_url',
]);

const read = async (group: string, name: string) =>
  (await gateway.findByKey(group, name))?.value ?? null;
/** As work that said it is not for the assistant reads it. */
const live = (group: string, name: string) =>
  withLiveSettings(() => read(group, name));
/** As work done for the assistant reads it. */
const approved = (group: string, name: string) =>
  servingAssistant(true, () => read(group, name));
/** What the Owner is shown, and sends back with the apply. */
const shown = async () => ({ shown: (await driftController.read()).drift });
const applyShown = async () => driftController.apply(await shown());
const tokenOf = async () =>
  (
    JSON.parse(
      text(await driftTool.getAssistantSettings({}, null, viaAssistant(OWNER))),
    ) as { applyToken?: string }
  ).applyToken;

// ── What the deploy reads ────────────────────────────────────

describe('what the assistant’s deploy reads', () => {
  it('reads settings, and only from the groups it is served the approved values of', async () => {
    await world.assembled();
    const groups = [...new Set(db.reads.map((key) => key.split('.')[0]))];
    expect(groups.length).toBeGreaterThan(0);
    // (e) A deploy that starts reading a new group fails here until the
    // group is one the assistant is served.
    for (const group of groups) {
      expect([group, APPROVED_SETTING_GROUPS.includes(group)]).toEqual([
        group,
        true,
      ]);
    }
    // The addresses and keys the report lists are really among them.
    for (const key of [
      'integrations.s3_bucket',
      'integrations.ranch_api_url',
      'integrations.bridle_url',
      'integrations.bridle_api_key',
      'integrations.aws_secret_access_key',
      'integrations.secret_provider',
      'infrastructure.argo_url',
    ]) {
      expect(db.reads).toContain(key);
    }
  });

  it('the assembled pod holds them, so a change shows', async () => {
    const pod = await world.assembled();
    expect(pod).toContain('approved-integrations-ranch_api_url');
    expect(pod).toContain('approved-integrations-s3_bucket');
    expect(pod).toContain('APPROVED-SECRET-KEY');
    expect(pod).toContain('"submittedTo": "approved-infrastructure-argo_url"');
    expect(pod).toContain(
      '"(copied by the API from bucket)",\n      "approved-integrations-s3_bucket"',
    );
  });
});

// ── (a) An Admin changes each of them ────────────────────────

describe.each(SERVED)('an Admin changes %s.%s', (group, name) => {
  const key = `${group}.${name}`;
  const was = () => db.settings.get(key)!.value;

  it('through the route: the assistant’s next pod is byte-identical, the live value is the new one', async () => {
    const pod = await world.assembled();
    const others = await world.assembled(ALPHA);
    const before = was();

    const write = () =>
      settingsController.upsert(
        group,
        name,
        { value: 'changed-by-an-admin', valueType: 'string' },
        http(ADMIN),
      );
    if (key === 'agent_defaults.image') {
      // That one key is the Owner's to write at all: 403, nothing moved.
      await expect(write()).rejects.toMatchObject({ status: 403 });
      expect(await live(group, name)).toBe(before);
      expect(await world.assembled()).toBe(pod);
      return;
    }
    await write();
    infraConfig.invalidate();

    expect(await live(group, name)).toBe('changed-by-an-admin');
    expect(await approved(group, name)).toBe(before);
    expect(await world.assembled()).toBe(pod);
    if (IN_EVERY_POD.has(key)) {
      // An ordinary agent is deployed from the live settings, as before.
      const now = await world.assembled(ALPHA);
      expect(now).not.toBe(others);
      expect(now).toContain('changed-by-an-admin');
    }
  });

  it('through the tool, and by deleting it: the same', async () => {
    const pod = await world.assembled();
    const before = was();

    const said = text(
      await rancherTool.upsertSetting(
        { group, name, value: 'changed-through-a-tool', valueType: 'string' },
        null,
        viaAssistant(ADMIN),
      ),
    );
    infraConfig.invalidate();
    if (key === 'agent_defaults.image') {
      // That one key is the Owner's to write at all.
      expect(said).toContain('owner_only');
      expect(await live(group, name)).toBe(before);
    } else {
      expect(await live(group, name)).toBe('changed-through-a-tool');
    }
    expect(await approved(group, name)).toBe(before);
    expect(await world.assembled()).toBe(pod);

    if (key !== 'agent_defaults.image') {
      await settingTool.deleteSetting(
        { group, name, confirm: true },
        null,
        viaAssistant(ADMIN),
      );
      infraConfig.invalidate();
      expect(await live(group, name)).toBeNull();
      expect(await approved(group, name)).toBe(before);
      expect(await world.assembled()).toBe(pod);
    }
  });
});

describe('an Admin’s other ways to move a setting', () => {
  it('a setting that did not exist: the assistant keeps reading "not set"', async () => {
    db.settings.delete('integrations.s3_endpoint_agent');
    const pod = await world.assembled();
    await settingsController.upsert(
      'integrations',
      's3_endpoint_agent',
      { value: 'https://attacker.example', valueType: 'string' },
      http(ADMIN),
    );
    expect(await live('integrations', 's3_endpoint_agent')).toBe(
      'https://attacker.example',
    );
    expect(await approved('integrations', 's3_endpoint_agent')).toBeNull();
    expect(await world.assembled()).toBe(pod);
    expect((await service.drift())[0]).toMatchObject({
      group: 'integrations',
      name: 's3_endpoint_agent',
      change: 'added',
      changedById: ADMIN.id,
    });
  });

  it('twice: the approved value is the Owner’s, not the Admin’s first one', async () => {
    const dto = (value: string) => ({ value, valueType: 'string' as const });
    await settingsController.upsert(
      'integrations',
      's3_bucket',
      dto('one'),
      http(ADMIN),
    );
    await settingsController.upsert(
      'integrations',
      's3_bucket',
      dto('two'),
      http(ADMIN),
    );
    expect(await approved('integrations', 's3_bucket')).toBe(
      'approved-integrations-s3_bucket',
    );
    expect(db.pins.size).toBe(1);
  });

  it('and back: a value returned to the approved one is no drift', async () => {
    const dto = (value: string) => ({ value, valueType: 'string' as const });
    await settingsController.upsert(
      'integrations',
      's3_bucket',
      dto('one'),
      http(ADMIN),
    );
    expect(await service.drift()).toHaveLength(1);
    await settingsController.upsert(
      'integrations',
      's3_bucket',
      dto('approved-integrations-s3_bucket'),
      http(ADMIN),
    );
    expect(await service.drift()).toEqual([]);
  });

  it('a group the assistant is not served from is written as before, with no record', async () => {
    await settingsController.upsert(
      'organization',
      'name',
      { value: 'Renamed', valueType: 'string' },
      http(ADMIN),
    );
    expect(await live('organization', 'name')).toBe('Renamed');
    expect(await approved('organization', 'name')).toBe('Renamed');
    expect(db.pins.size).toBe(0);
  });

  it('the list reads are served too: a whole group, and every setting', async () => {
    await settingsController.upsert(
      'integrations',
      's3_bucket',
      { value: 'attacker-bucket', valueType: 'string' },
      http(ADMIN),
    );
    const bucketOf = (rows: ISettingData[]) =>
      rows.find(
        (row) => row.group === 'integrations' && row.name === 's3_bucket',
      )?.value;
    expect(
      bucketOf(
        await withLiveSettings(() => gateway.findByGroup('integrations')),
      ),
    ).toBe('attacker-bucket');
    expect(
      bucketOf(
        await servingAssistant(true, () => gateway.findByGroup('integrations')),
      ),
    ).toBe('approved-integrations-s3_bucket');
    expect(
      bucketOf(await servingAssistant(true, () => gateway.findAll())),
    ).toBe('approved-integrations-s3_bucket');
    // Not for an agent that is not the assistant.
    expect(
      bucketOf(
        await servingAgentId(ALPHA, () => gateway.findByGroup('integrations')),
      ),
    ).toBe('attacker-bucket');
    expect(
      bucketOf(
        await servingAgentId(RANCH, () => gateway.findByGroup('integrations')),
      ),
    ).toBe('approved-integrations-s3_bucket');
  });

  it('the infra config’s cache of live values is neither read nor filled for the assistant', async () => {
    const liveArgo = () => withLiveSettings(() => infraConfig.getArgoUrl());
    expect(await liveArgo()).toBe('approved-infrastructure-argo_url');
    await settingsController.upsert(
      'infrastructure',
      'argo_url',
      { value: 'https://attacker.example', valueType: 'string' },
      http(ADMIN),
    );
    // The controller drops the cache on this group; were it still warm with
    // the Admin's value, the assistant must not be answered from it.
    expect(await liveArgo()).toBe('https://attacker.example');
    expect(await servingAssistant(true, () => infraConfig.getArgoUrl())).toBe(
      'approved-infrastructure-argo_url',
    );
    // Work that declared nothing is not answered from the cache either.
    expect(await infraConfig.getArgoUrl()).toBe(
      'approved-infrastructure-argo_url',
    );
    // And neither read put the approved value in the cache.
    expect(await liveArgo()).toBe('https://attacker.example');
  });
});

// ── (b) The Owner changes one ────────────────────────────────

describe('the Owner changes a setting', () => {
  it('both the assistant and an ordinary agent pick it up, and nothing is kept back', async () => {
    const pod = await world.assembled();
    const others = await world.assembled(ALPHA);
    await settingsController.upsert(
      'integrations',
      's3_bucket',
      { value: 'owners-new-bucket', valueType: 'string' },
      http(OWNER),
    );
    expect(db.pins.size).toBe(0);
    const now = await world.assembled();
    expect(now).not.toBe(pod);
    expect(now).toContain('owners-new-bucket');
    expect(await world.assembled(ALPHA)).not.toBe(others);
  });

  it('after an Admin changed it: the Owner’s write is the approval', async () => {
    const dto = (value: string) => ({ value, valueType: 'string' as const });
    await settingsController.upsert(
      'integrations',
      'ranch_api_url',
      dto('https://attacker.example'),
      http(ADMIN),
    );
    expect(await service.drift()).toHaveLength(1);
    await rancherTool.upsertSetting(
      {
        group: 'integrations',
        name: 'ranch_api_url',
        value: 'https://api.ranch.example',
        valueType: 'string',
      },
      null,
      viaAssistant(OWNER),
    );
    expect(await service.drift()).toEqual([]);
    expect(await approved('integrations', 'ranch_api_url')).toBe(
      'https://api.ranch.example',
    );
    expect(await world.assembled()).toContain('https://api.ranch.example');
  });

  it('the assistant acting for itself writes as the Owner does', async () => {
    await rancherTool.upsertSetting(
      {
        group: 'integrations',
        name: 's3_bucket',
        value: 'set-on-schedule',
        valueType: 'string',
      },
      null,
      asTrustedAgent({
        user: {
          sub: `agent:${RANCH}`,
          email: '',
          roles: [UserRoleTypes.Owner],
        },
      } as unknown as Request),
    );
    expect(db.pins.size).toBe(0);
    expect(await approved('integrations', 's3_bucket')).toBe('set-on-schedule');
  });
});

// ── (c) Apply current settings to the assistant ──────────────

describe('apply current settings to the assistant', () => {
  const change = () =>
    settingsController.upsert(
      'integrations',
      's3_bucket',
      { value: 'admins-bucket', valueType: 'string' },
      http(ADMIN),
    );

  it('the Owner applies: the live values become the approved ones, and the pod changes', async () => {
    const pod = await world.assembled();
    await change();
    expect(await world.assembled()).toBe(pod);

    expect(await applyShown()).toEqual({
      applied: ['integrations.s3_bucket'],
    });
    expect(await service.drift()).toEqual([]);
    const now = await world.assembled();
    expect(now).not.toBe(pod);
    expect(now).toContain('admins-bucket');
  });

  it('the tool asks first, applies on confirm, and has nothing to do when nothing differs', async () => {
    expect(
      text(
        await driftTool.applySettingsToAssistant(
          { applyToken: 'none', confirm: true },
          null,
          viaAssistant(OWNER),
        ),
      ),
    ).toContain('Nothing to apply');
    await change();
    const applyToken = await tokenOf();
    const asked = text(
      await driftTool.applySettingsToAssistant(
        { applyToken },
        null,
        viaAssistant(OWNER),
      ),
    );
    expect(asked).toContain('integrations.s3_bucket');
    expect(db.pins.size).toBe(1);
    const done = text(
      await driftTool.applySettingsToAssistant(
        { applyToken, confirm: true },
        null,
        viaAssistant(OWNER),
      ),
    );
    expect(JSON.parse(done)).toMatchObject({
      applied: ['integrations.s3_bucket'],
    });
    expect(db.pins.size).toBe(0);
  });

  it('an Admin is refused: by the tool, by its listing, and by the role on both routes', async () => {
    await change();
    await expect(
      driftTool.applySettingsToAssistant(
        { applyToken: await tokenOf(), confirm: true },
        null,
        viaAssistant(ADMIN),
      ),
    ).rejects.toThrow(/operator role|Owner/);
    await expect(
      driftTool.getAssistantSettings({}, null, viaAssistant(ADMIN)),
    ).rejects.toThrow();
    expect(await driftTool.isListedForRequest(viaAssistant(ADMIN))).toBe(false);
    expect(await driftTool.isListedForRequest(viaAssistant(OWNER))).toBe(true);
    expect(db.pins.size).toBe(1);

    const routes = appRoutes().filter((row) =>
      row.route.includes('/rancher/settings'),
    );
    expect(routes.map((row) => row.route).sort()).toEqual([
      'GET /rancher/settings',
      'POST /rancher/settings/apply',
    ]);
    for (const row of routes) {
      expect([row.route, row.roles]).toEqual([
        row.route,
        [UserRoleTypes.Owner],
      ]);
    }
  });
});

// ── (d) The drift, told by key and never by value ────────────

describe('the drift is told to the Owner without a value', () => {
  const SECRETS = [
    'APPROVED-SECRET-KEY',
    'ATTACKERS-SECRET-KEY',
    'APPROVED-HUB-KEY',
  ];
  const without = (body: unknown) => {
    const said = typeof body === 'string' ? body : JSON.stringify(body);
    for (const secret of SECRETS) expect(said).not.toContain(secret);
    return said;
  };

  beforeEach(async () => {
    await settingsController.upsert(
      'integrations',
      'aws_secret_access_key',
      { value: 'ATTACKERS-SECRET-KEY', valueType: 'string' },
      http(ADMIN),
    );
    await settingsController.remove(
      'integrations',
      'bridle_api_key',
      http(ADMIN),
    );
  });

  it('GET /rancher/settings: the keys, what happened, who and when', async () => {
    const body = await driftController.read();
    expect(body.drift).toEqual([
      {
        group: 'integrations',
        name: 'aws_secret_access_key',
        change: 'changed',
        changedById: ADMIN.id,
        changedByName: 'Ada Admin',
        changedAt: expect.any(Date) as unknown,
        version: expect.any(String) as unknown,
      },
      {
        group: 'integrations',
        name: 'bridle_api_key',
        change: 'removed',
        changedById: ADMIN.id,
        changedByName: 'Ada Admin',
        changedAt: expect.any(Date) as unknown,
        version: expect.any(String) as unknown,
      },
    ]);
    without(body);
  });

  it('GET /rancher/status: the Owner gets it, an Admin gets no such field', async () => {
    const owners = await rancherController.status(http(OWNER));
    expect(
      owners.settingsDrift?.map((row) => `${row.group}.${row.name}`),
    ).toEqual([
      'integrations.aws_secret_access_key',
      'integrations.bridle_api_key',
    ]);
    without(owners.settingsDrift);
    const admins = await rancherController.status(http(ADMIN));
    expect(admins).not.toHaveProperty('settingsDrift');
  });

  it('the tools: get_assistant_settings, and the assistant’s status when the Owner asks', async () => {
    const said = without(
      text(await driftTool.getAssistantSettings({}, null, viaAssistant(OWNER))),
    );
    expect(said).toContain('integrations.aws_secret_access_key');
    const status = without(
      text(await rancherTool.getRancherStatus({}, null, viaAssistant(OWNER))),
    );
    expect(status).toContain('settingsDrift');
    expect(status).toContain('integrations.bridle_api_key');
    expect(
      text(await rancherTool.getRancherStatus({}, null, viaAssistant(ADMIN))),
    ).not.toContain('settingsDrift');
  });

  it('nothing differs: an empty list, and no field in the tool’s status', async () => {
    await applyShown();
    expect(await driftController.read()).toEqual({ drift: [] });
    expect(
      text(await rancherTool.getRancherStatus({}, null, viaAssistant(OWNER))),
    ).not.toContain('settingsDrift');
  });
});

// ── A request made for the assistant ─────────────────────────

describe('a request made for the assistant reads the approved settings', () => {
  const interceptor = new AssistantSettingInterceptor();
  const through = (req: object) =>
    lastValueFrom(
      interceptor.intercept(
        {
          getType: () => 'http',
          switchToHttp: () => ({ getRequest: () => req }),
        } as unknown as ExecutionContext,
        { handle: () => defer(() => read('integrations', 's3_bucket')) },
      ),
    );

  beforeEach(() =>
    settingsController.upsert(
      'integrations',
      's3_bucket',
      { value: 'admins-bucket', valueType: 'string' },
      http(ADMIN),
    ),
  );

  it('a route that names the assistant, and a call with its runtime’s token', async () => {
    expect(
      await through({ user: http(OWNER).user, params: { id: RANCH } }),
    ).toBe('approved-integrations-s3_bucket');
    expect(
      await through({ user: http(OWNER).user, params: { agentId: RANCH } }),
    ).toBe('approved-integrations-s3_bucket');
    expect(
      await through({ user: { sub: `agent:${RANCH}`, roles: [] }, params: {} }),
    ).toBe('approved-integrations-s3_bucket');
  });

  it('the assistant named anywhere else: another parameter, the query, the body of a tool call', async () => {
    const owners = http(OWNER).user;
    for (const req of [
      { user: owners, params: { targetAgentId: RANCH } },
      { user: owners, params: {}, query: { agentId: RANCH } },
      { user: owners, params: {}, query: { filter: `agent:${RANCH}` } },
      { user: owners, params: {}, body: { agentId: RANCH } },
      {
        user: owners,
        params: {},
        body: {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { name: 'restart_agent', arguments: { id: RANCH } },
        },
      },
      {
        user: owners,
        params: {},
        body: { agents: [{ id: ALPHA }, { id: RANCH }] },
      },
    ]) {
      expect([JSON.stringify(req).slice(0, 60), await through(req)]).toEqual([
        JSON.stringify(req).slice(0, 60),
        'approved-integrations-s3_bucket',
      ]);
    }
  });

  it('any other agent, and a request that names none: the live value', async () => {
    expect(
      await through({ user: http(ADMIN).user, params: { id: ALPHA } }),
    ).toBe('admins-bucket');
    expect(
      await through({ user: { sub: `agent:${ALPHA}`, roles: [] }, params: {} }),
    ).toBe('admins-bucket');
    expect(await through({ user: http(OWNER).user, params: {} })).toBe(
      'admins-bucket',
    );
  });

  it('with nothing kept back the request goes through, and is the assistant’s all the same', async () => {
    await applyShown();
    expect(db.pins.size).toBe(0);
    const states: string[] = [];
    const seen = (req: object) =>
      lastValueFrom(
        interceptor.intercept(
          {
            getType: () => 'http',
            switchToHttp: () => ({ getRequest: () => req }),
          } as unknown as ExecutionContext,
          {
            handle: () =>
              defer(() => {
                states.push(settingScopeState());
                return of('handled');
              }),
          },
        ),
      );
    expect(await seen({ user: http(OWNER).user, params: { id: RANCH } })).toBe(
      'handled',
    );
    expect(await seen({ user: http(OWNER).user, params: { id: ALPHA } })).toBe(
      'handled',
    );
    // Whether anything is kept back at this instant does not decide it.
    expect(states).toEqual(['approved', 'live']);
  });
});

// ── A write that lands in the middle of the work ─────────────

describe('a setting changed while work for the assistant is under way', () => {
  const adminSets = (group: string, name: string, value: string) =>
    settingsController.upsert(
      group,
      name,
      { value, valueType: 'string' },
      http(ADMIN),
    );

  it('the scope holds no copy: a read made after an Admin’s write, in work that began before it, is the approved value', async () => {
    expect(db.pins.size).toBe(0);
    const [before, after] = await servingAssistant(true, async () => {
      const first = await read('integrations', 's3_bucket');
      await adminSets('integrations', 's3_bucket', 'admins-bucket');
      return [first, await read('integrations', 's3_bucket')];
    });
    expect(before).toBe('approved-integrations-s3_bucket');
    expect(after).toBe('approved-integrations-s3_bucket');
    expect(await live('integrations', 's3_bucket')).toBe('admins-bucket');
  });

  it('a deploy: an Admin writes between any two of its setting reads, and the pod is byte-identical to the approved one', async () => {
    const approvedPod = await world.assembled();
    const reads = meanwhile.snapshots;
    // The deploy does read settings, several times over.
    expect(reads).toBeGreaterThan(3);

    // Every setting a pod is built from, changed at once by the Admin.
    const sabotage = async () => {
      for (const key of IN_EVERY_POD) {
        const [group, name] = key.split('.');
        await adminSets(group, name, `admins-${name}`);
      }
    };
    for (let at = 1; at <= reads; at += 1) {
      approvedState();
      infraConfig.invalidate();
      world.reset();
      meanwhile.snapshots = 0;
      let fired = false;
      meanwhile.beforeSnapshot = async (n) => {
        if (n !== at || fired) return;
        fired = true;
        // The Admin's own request reads and writes live, outside the deploy.
        await withLiveSettings(sabotage);
      };
      const pod = await world.assembled();
      meanwhile.beforeSnapshot = null;
      expect([at, fired]).toEqual([at, true]);
      expect([at, pod === approvedPod]).toEqual([at, true]);
      // The check has teeth: an ordinary agent deployed now has the change.
      expect(await world.assembled(ALPHA)).toContain('admins-s3_bucket');
    }
  });

  it('and inside one read: a write that commits after the snapshot was taken changes nothing of it', async () => {
    const approvedPod = await world.assembled();
    const reads = meanwhile.snapshots;
    for (let at = 1; at <= reads; at += 1) {
      approvedState();
      infraConfig.invalidate();
      world.reset();
      meanwhile.snapshots = 0;
      meanwhile.insideSnapshot = async (n) => {
        if (n !== at) return;
        await withLiveSettings(() =>
          adminSets('integrations', 's3_bucket', 'admins-bucket'),
        );
        await withLiveSettings(() =>
          adminSets('integrations', 'ranch_api_url', 'https://evil.example'),
        );
      };
      const pod = await world.assembled();
      meanwhile.insideSnapshot = null;
      expect([at, pod === approvedPod]).toEqual([at, true]);
    }
  });

  it('an Admin’s value that was put back while it was being read is not served either', async () => {
    // The row holds the Admin's value and the approved one is kept for it.
    await adminSets('integrations', 's3_bucket', 'admins-bucket');
    meanwhile.snapshots = 0;
    // After the snapshot: the Admin puts the approved value back, which
    // drops what was kept. Read in two steps, the row would be the Admin's
    // and nothing would be found kept for it.
    meanwhile.insideSnapshot = async () => {
      meanwhile.insideSnapshot = null;
      await withLiveSettings(() =>
        adminSets(
          'integrations',
          's3_bucket',
          'approved-integrations-s3_bucket',
        ),
      );
    };
    expect(await approved('integrations', 's3_bucket')).toBe(
      'approved-integrations-s3_bucket',
    );
    expect(db.pins.size).toBe(0);
  });

  it('every read that is not declared live asks the database for one snapshot', async () => {
    await world.assembled();
    await read('integrations', 's3_bucket');
    await gateway.findByGroup('integrations');
    await gateway.findAll();
    expect(meanwhile.asked.length).toBeGreaterThan(5);
    expect(new Set(meanwhile.asked)).toEqual(new Set(['RepeatableRead']));
    // Live work reads the table as it is and opens no transaction.
    meanwhile.asked.length = 0;
    await live('integrations', 's3_bucket');
    await world.assembled(ALPHA);
    expect(meanwhile.asked).toEqual([]);
  });

  it('a request for the assistant that began with nothing kept back does not follow a change made a moment later', async () => {
    const interceptor = new AssistantSettingInterceptor();
    expect(db.pins.size).toBe(0);
    const through = (req: object, handle: () => Promise<unknown>) =>
      lastValueFrom(
        interceptor.intercept(
          {
            getType: () => 'http',
            switchToHttp: () => ({ getRequest: () => req }),
          } as unknown as ExecutionContext,
          { handle: () => defer(handle) },
        ),
      );
    // The request is admitted, the table is empty; then the Admin writes;
    // then the request does its work, which here is the assistant's deploy.
    const approvedPod = await world.assembled();
    world.reset();
    const pod = await through(
      { user: http(OWNER).user, params: { id: RANCH } },
      async () => {
        await withLiveSettings(async () => {
          for (const key of IN_EVERY_POD) {
            const [group, name] = key.split('.');
            await adminSets(group, name, `admins-${name}`);
          }
        });
        return [
          await read('integrations', 's3_bucket'),
          await world.assembled(),
        ];
      },
    );
    expect(pod).toEqual(['approved-integrations-s3_bucket', approvedPod]);
    // The same request for another agent reads what the Admin wrote.
    expect(
      await through({ user: http(ADMIN).user, params: { id: ALPHA } }, () =>
        read('integrations', 's3_bucket'),
      ),
    ).toBe('admins-s3_bucket');
  });
});

// ── Work that does not say whom it is for ────────────────────

describe('work that declares nothing reads the approved settings', () => {
  beforeEach(() =>
    settingsController.upsert(
      'integrations',
      's3_bucket',
      { value: 'admins-bucket', valueType: 'string' },
      http(ADMIN),
    ),
  );

  it('a hub handler, a scheduled job, a path nobody thought about: approved, never the Admin’s value', async () => {
    // No scope at all, as a socket handler or a timer runs.
    expect(await read('integrations', 's3_bucket')).toBe(
      'approved-integrations-s3_bucket',
    );
    expect(
      (await gateway.findByGroup('integrations')).find(
        (row) => row.name === 's3_bucket',
      )?.value,
    ).toBe('approved-integrations-s3_bucket');
    expect(await infraConfig.getArgoUrl()).toBe(
      'approved-infrastructure-argo_url',
    );
    // Declared for another agent, it is live.
    expect(
      await servingAgentId(ALPHA, () => read('integrations', 's3_bucket')),
    ).toBe('admins-bucket');
  });

  it('the deploy path declares every read it makes, for the assistant and for an ordinary agent', async () => {
    const undeclared: string[] = [];
    onUndeclaredSettingRead((key) => undeclared.push(key));
    await world.assembled();
    await world.assembled(ALPHA);
    const ranch = (await world.agents.findAdmin())!;
    await world.workflows.previewAgentEnv(ranch);
    await world.workflows.previewAgentEnv(
      (await world.agents.findById(ALPHA))!,
    );
    // A read that reached the gateway with nothing declared would be listed
    // here: a new step of the deploy that forgot to say whom it serves.
    expect(undeclared).toEqual([]);
    // And the listener does hear an undeclared read.
    await read('integrations', 's3_bucket');
    expect(undeclared).toEqual(['integrations.s3_bucket']);
  });
});

// ── The Owner applies what they were shown ───────────────────

describe('an apply is bound to the list the Owner was shown', () => {
  const adminSets = (name: string, value: string) =>
    settingsController.upsert(
      'integrations',
      name,
      { value, valueType: 'string' },
      http(ADMIN),
    );
  const REFUSED = {
    status: 409,
    response: { code: 'SETTINGS_CHANGED' },
  };

  it('an Admin changes the same setting again between the look and the apply: refused, nothing moves', async () => {
    await adminSets('ranch_api_url', 'https://looked-at.example');
    const looked = await shown();
    const pod = await world.assembled();

    await adminSets('ranch_api_url', 'https://swapped-in.example');

    await expect(driftController.apply(looked)).rejects.toMatchObject(REFUSED);
    expect(await approved('integrations', 'ranch_api_url')).toBe(
      'approved-integrations-ranch_api_url',
    );
    expect(await world.assembled()).toBe(pod);
    expect(db.pins.size).toBe(1);
    // Looked at again, it applies.
    expect(await applyShown()).toEqual({
      applied: ['integrations.ranch_api_url'],
    });
    expect(await approved('integrations', 'ranch_api_url')).toBe(
      'https://swapped-in.example',
    );
  });

  it('an Admin changes ANOTHER setting in between: refused whole, the one that was shown included', async () => {
    await adminSets('s3_bucket', 'looked-at-bucket');
    const looked = await shown();
    await adminSets('ranch_api_url', 'https://not-looked-at.example');

    await expect(driftController.apply(looked)).rejects.toMatchObject(REFUSED);
    expect(db.pins.size).toBe(2);
    expect(await approved('integrations', 's3_bucket')).toBe(
      'approved-integrations-s3_bucket',
    );
  });

  it('a list that names less, more, or nothing is not the list: refused', async () => {
    await adminSets('s3_bucket', 'one');
    await adminSets('ranch_api_url', 'https://two.example');
    const looked = await shown();
    await expect(
      driftController.apply({ shown: [looked.shown[0]] }),
    ).rejects.toMatchObject(REFUSED);
    await expect(driftController.apply({ shown: [] })).rejects.toMatchObject(
      REFUSED,
    );
    await expect(
      driftController.apply({
        shown: looked.shown.map((row) => ({ ...row, version: 'made-up' })),
      }),
    ).rejects.toMatchObject(REFUSED);
    expect(db.pins.size).toBe(2);
  });

  it('the tool’s confirmation is for the list it listed: a change in between is refused with the new list', async () => {
    await adminSets('ranch_api_url', 'https://looked-at.example');
    const applyToken = await tokenOf();
    await adminSets('ranch_api_url', 'https://swapped-in.example');

    const said = JSON.parse(
      text(
        await driftTool.applySettingsToAssistant(
          { applyToken, confirm: true },
          null,
          viaAssistant(OWNER),
        ),
      ),
    ) as { reason?: string; applyToken?: string; error?: string };
    expect(said.reason).toBe('settings_changed');
    expect(said.error).toContain('changed since you looked');
    expect(said.applyToken).not.toBe(applyToken);
    expect(db.pins.size).toBe(1);
    expect(await approved('integrations', 'ranch_api_url')).toBe(
      'approved-integrations-ranch_api_url',
    );
    // Without a token at all it is refused the same way.
    expect(
      text(
        await driftTool.applySettingsToAssistant(
          { confirm: true } as never,
          null,
          viaAssistant(OWNER),
        ),
      ),
    ).toContain('settings_changed');
    expect(db.pins.size).toBe(1);
  });

  it('a change that lands between the comparison and the delete is refused by the delete', async () => {
    await adminSets('ranch_api_url', 'https://looked-at.example');
    const looked = await shown();
    // The row is rewritten after `drift()` was compared and before the
    // transaction deletes: the conditional delete finds another row.
    const original = prisma.$transaction;
    prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => {
      // Once: the Admin's own write runs in a transaction of its own.
      prisma.$transaction = original;
      await adminSets('ranch_api_url', 'https://raced-in.example');
      return run(prisma);
    }) as never;
    try {
      await expect(driftController.apply(looked)).rejects.toMatchObject(
        REFUSED,
      );
    } finally {
      prisma.$transaction = original;
    }
    expect(db.pins.size).toBe(1);
    expect(await approved('integrations', 'ranch_api_url')).toBe(
      'approved-integrations-ranch_api_url',
    );
  });
});

// ── (e) One reader ───────────────────────────────────────────

describe('settings have one reader', () => {
  const SLICES = join(__dirname, '..', '..', '..');
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__fixtures__' ? [] : sources(path);
      }
      return /\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)
        ? [path]
        : [];
    });
  const relative = (path: string) =>
    path
      .slice(SLICES.length + 1)
      .split('\\')
      .join('/');

  it('only the settings gateway reads the settings table, and only this service reads the approved values', () => {
    const files = sources(SLICES);
    expect(files.length).toBeGreaterThan(300);
    const reading = (pattern: RegExp) =>
      files
        .filter((file) => pattern.test(readFileSync(file, 'utf8')))
        .map(relative)
        .sort();
    // A file that reads `prisma.setting` itself reads past the scope: the
    // assistant would be served the live value there.
    expect(reading(/\b(?:prisma|tx|client)\s*\.\s*setting\s*\./)).toEqual([
      'setting/data/setting.gateway.ts',
    ]);
    expect(reading(/assistantSettingPin/)).toEqual([
      'agent/assistantBuild/domain/assistantSetting.service.ts',
    ]);
  });

  it('a person’s write goes through `writeBy`: the routes and the two tools, and nothing else writes for a person', () => {
    const files = sources(SLICES);
    const calling = (pattern: RegExp) =>
      files
        .filter((file) => pattern.test(readFileSync(file, 'utf8')))
        .map(relative)
        .sort();
    expect(calling(/writeSettingBy\(|\.writeBy\(/)).toEqual([
      'rancher/rancher.tool.ts',
      'setting/domain/setting.gateway.ts',
      'setting/setting.controller.ts',
      'setting/setting.tool.ts',
    ]);
    // What still calls `upsert` / `delete` on the gateway is the platform's
    // own bookkeeping, each filed here with what it writes.
    const direct = files
      .filter((file) =>
        /\b(?:settings|settingGateway|gateway)\.(?:upsert|delete)\(\s*(?:group|SEEDED_HASH_GROUP|SETTING_GROUP|GROUP|')/.test(
          readFileSync(file, 'utf8'),
        ),
      )
      .map(relative)
      .sort();
    expect(direct).toEqual([
      // rancher.seeded_hash, after the API seeded the template itself.
      'rancher/domain/rancher.service.ts',
      // knowledge.shared_pool_decommissioned, a migration's own flag.
      'reins/config/data/knowledgeConfig.gateway.ts',
      // The defaults of the `infrastructure` group, written at first start.
      'setting/data/infraConfig.gateway.ts',
      // `writeBy`'s fallback for a stand-in gateway.
      'setting/domain/setting.gateway.ts',
    ]);
  });
});
