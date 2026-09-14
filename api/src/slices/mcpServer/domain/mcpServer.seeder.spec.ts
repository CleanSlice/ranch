import { ConfigService } from '@nestjs/config';
import {
  CLEANSLICE_MCP_ID,
  DEFAULT_RANCH_MCP_URL,
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
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
  it('points at the api Service that k8s/platform/api actually deploys', () => {
    // Service: name ranch-api, namespace platform, port 3000. Agents run in
    // the `agents` namespace, so the cross-namespace form is required.
    expect(DEFAULT_RANCH_MCP_URL).toBe(
      'http://ranch-api.platform.svc.cluster.local:3000/mcp/mcp',
    );
  });

  it('is not the old host, which resolves nowhere in any deployment', () => {
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
        url: 'http://api:3001/mcp/mcp',
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
