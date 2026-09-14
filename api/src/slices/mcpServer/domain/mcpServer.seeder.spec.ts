import { ConfigService } from '@nestjs/config';
import {
  CLEANSLICE_MCP_ID,
  DEFAULT_RANCH_MCP_URL,
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
  LEGACY_RANCH_MCP_URL,
  McpServerSeeder,
  RANCH_MCP_ID,
} from './mcpServer.seeder';
import { IMcpServerGateway } from './mcpServer.gateway';
import type { IMcpServerData } from './mcpServer.types';

/**
 * The built-in rows are the only MCP servers an operator cannot repair by
 * hand: PATCH strips everything but enabled/description for a built-in and
 * DELETE refuses one outright. Whatever the seeder writes is what every agent
 * gets, so these pin the two things that matter — the address is one that
 * exists, and a row that has drifted is brought back.
 */
class FakeGateway {
  rows = new Map<string, IMcpServerData>();
  updates: Array<{ id: string; url?: string }> = [];

  findById(id: string): Promise<IMcpServerData | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(data: Record<string, unknown>): Promise<IMcpServerData> {
    const row = data as unknown as IMcpServerData;
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: string, data: { url?: string }): Promise<IMcpServerData> {
    this.updates.push({ id, url: data.url });
    const row = this.rows.get(id);
    if (row && data.url) this.rows.set(id, { ...row, url: data.url });
    return Promise.resolve(this.rows.get(id) as IMcpServerData);
  }
}

function build(env: Record<string, string | undefined> = {}) {
  const gateway = new FakeGateway();
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const seeder = new McpServerSeeder(
    gateway as unknown as IMcpServerGateway,
    config,
  );
  return { gateway, seeder };
}

/** Every built-in that is served by the api itself, so shares one URL. */
const API_HOSTED = [RANCH_MCP_ID, KNOWLEDGE_MCP_ID, DOCUMENTS_MCP_ID];

describe('DEFAULT_RANCH_MCP_URL', () => {
  it('is the cross-namespace address that answers in the live cluster', () => {
    // Agent pods run in `agents`, the api in `platform`. This is the address
    // the Ranch and Knowledge rows were corrected to by hand and whose
    // endpoint responds.
    expect(DEFAULT_RANCH_MCP_URL).toBe(
      'http://ranch-api.platform.svc.cluster.local/mcp/mcp',
    );
  });

  it('is not the legacy host, which resolves nowhere in any deployment', () => {
    expect(DEFAULT_RANCH_MCP_URL).not.toBe(LEGACY_RANCH_MCP_URL);
    expect(DEFAULT_RANCH_MCP_URL).not.toContain('http://api:3001');
  });
});

describe('McpServerSeeder on a fresh database', () => {
  it('seeds every api-hosted built-in at the default url', async () => {
    const { gateway, seeder } = build();
    await seeder.onApplicationBootstrap();

    for (const id of API_HOSTED) {
      expect(gateway.rows.get(id)?.url).toBe(DEFAULT_RANCH_MCP_URL);
    }
  });

  it('seeds them as enabled built-ins carrying the agent token', async () => {
    const { gateway, seeder } = build();
    await seeder.onApplicationBootstrap();

    const documents = gateway.rows.get(DOCUMENTS_MCP_ID);
    expect(documents?.builtIn).toBe(true);
    expect(documents?.enabled).toBe(true);
    expect(documents?.authValue).toBe('${RANCH_API_TOKEN}');
  });

  it('honours RANCH_MCP_URL for the api-hosted entries', async () => {
    const url = 'http://host.k3d.internal:3000/mcp/mcp';
    const { gateway, seeder } = build({ RANCH_MCP_URL: url });
    await seeder.onApplicationBootstrap();

    for (const id of API_HOSTED) {
      expect(gateway.rows.get(id)?.url).toBe(url);
    }
  });

  it('leaves the externally hosted CleanSlice entry on its own url', async () => {
    const { gateway, seeder } = build({
      RANCH_MCP_URL: 'http://host.k3d.internal:3000/mcp/mcp',
    });
    await seeder.onApplicationBootstrap();

    expect(gateway.rows.get(CLEANSLICE_MCP_ID)?.url).toBe(
      'https://mcp.cleanslice.org/mcp',
    );
  });
});

describe('McpServerSeeder healing an existing deployment', () => {
  /** A database seeded before the fix: the rows exist, pointing nowhere. */
  function seededWithBrokenUrl() {
    const { gateway, seeder } = build();
    for (const id of API_HOSTED) {
      gateway.rows.set(id, {
        id,
        url: LEGACY_RANCH_MCP_URL,
        builtIn: true,
        enabled: true,
      } as IMcpServerData);
    }
    return { gateway, seeder };
  }

  it('repairs every api-hosted built-in, not only CleanSlice', async () => {
    const { gateway, seeder } = seededWithBrokenUrl();
    await seeder.onApplicationBootstrap();

    for (const id of API_HOSTED) {
      expect(gateway.rows.get(id)?.url).toBe(DEFAULT_RANCH_MCP_URL);
    }
  });

  it('does not recreate a row it healed', async () => {
    const { gateway, seeder } = seededWithBrokenUrl();
    await seeder.onApplicationBootstrap();

    expect(gateway.updates.map((u) => u.id).sort()).toEqual(
      [...API_HOSTED].sort(),
    );
  });

  it('is idempotent — a second bootstrap writes nothing', async () => {
    const { gateway, seeder } = seededWithBrokenUrl();
    await seeder.onApplicationBootstrap();
    gateway.updates.length = 0;

    await seeder.onApplicationBootstrap();
    expect(gateway.updates).toEqual([]);
  });

  it('never touches enabled, so an operator who disabled one keeps it off', async () => {
    const { gateway, seeder } = seededWithBrokenUrl();
    gateway.rows.set(DOCUMENTS_MCP_ID, {
      ...(gateway.rows.get(DOCUMENTS_MCP_ID) as IMcpServerData),
      enabled: false,
    });

    await seeder.onApplicationBootstrap();

    expect(gateway.rows.get(DOCUMENTS_MCP_ID)?.enabled).toBe(false);
    expect(gateway.rows.get(DOCUMENTS_MCP_ID)?.url).toBe(DEFAULT_RANCH_MCP_URL);
  });
});

/**
 * The reason healing is narrowed. Because the api refuses to let anyone edit
 * a built-in's url, operators have fixed these rows straight in the database.
 * Production currently has Ranch and Knowledge on an address that works and
 * is NOT this default. Replacing it would break a live endpoint on the
 * strength of a value this code merely believes in — a worse outcome than
 * leaving a stale one alone.
 */
describe('McpServerSeeder meeting a hand-corrected row', () => {
  const HAND_FIXED = 'http://ranch-api.platform.svc.cluster.local:8080/mcp/mcp';

  function seededWith(url: string, ids: string[] = API_HOSTED) {
    const { gateway, seeder } = build();
    for (const id of ids) {
      gateway.rows.set(id, {
        id,
        url,
        builtIn: true,
        enabled: true,
      } as IMcpServerData);
    }
    return { gateway, seeder };
  }

  it('leaves a url an operator chose exactly as it is', async () => {
    const { gateway, seeder } = seededWith(HAND_FIXED);
    await seeder.onApplicationBootstrap();

    for (const id of API_HOSTED) {
      expect(gateway.rows.get(id)?.url).toBe(HAND_FIXED);
    }
    expect(gateway.updates).toEqual([]);
  });

  it('still repairs the dead legacy address on its neighbours', async () => {
    // The production shape: Ranch and Knowledge corrected by hand, Documents
    // missed and still on the address that answers nowhere.
    const { gateway, seeder } = seededWith(HAND_FIXED, [
      RANCH_MCP_ID,
      KNOWLEDGE_MCP_ID,
    ]);
    gateway.rows.set(DOCUMENTS_MCP_ID, {
      id: DOCUMENTS_MCP_ID,
      url: LEGACY_RANCH_MCP_URL,
      builtIn: true,
      enabled: true,
    } as IMcpServerData);

    await seeder.onApplicationBootstrap();

    expect(gateway.rows.get(RANCH_MCP_ID)?.url).toBe(HAND_FIXED);
    expect(gateway.rows.get(KNOWLEDGE_MCP_ID)?.url).toBe(HAND_FIXED);
    expect(gateway.rows.get(DOCUMENTS_MCP_ID)?.url).toBe(DEFAULT_RANCH_MCP_URL);
    expect(gateway.updates.map((u) => u.id)).toEqual([DOCUMENTS_MCP_ID]);
  });

  it('keeps converging CleanSlice unconditionally, as it did before', async () => {
    // That entry has no healOnlyFrom: its url is entirely the api's business
    // and the existing behaviour is deliberate.
    const { gateway, seeder } = build();
    gateway.rows.set(CLEANSLICE_MCP_ID, {
      id: CLEANSLICE_MCP_ID,
      url: 'https://mcp.cleanslice.org',
      builtIn: true,
      enabled: true,
    } as IMcpServerData);

    await seeder.onApplicationBootstrap();

    expect(gateway.rows.get(CLEANSLICE_MCP_ID)?.url).toBe(
      'https://mcp.cleanslice.org/mcp',
    );
  });
});
