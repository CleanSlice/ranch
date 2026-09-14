import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMcpServerGateway } from './mcpServer.gateway';

export const RANCH_MCP_ID = 'mcp-ranch';
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';
export const CLEANSLICE_MCP_ID = 'mcp-cleanslice';
export const DOCUMENTS_MCP_ID = 'mcp-documents';

/**
 * In-cluster address of this api's own MCP endpoint.
 *
 * It has to be the cross-namespace form: the Service is `ranch-api` in
 * `platform` on port 3000 (k8s/platform/api/service.yaml) while agent pods
 * run in `agents`. The previous default, `http://api:3001/mcp/mcp`, named a
 * host and a port that exist in no deployment — not in the cluster, and not
 * in the k3d local setup, whose CoreDNS only aliases host.k3d.internal. Every
 * agent therefore failed to connect and silently lost list_agents,
 * restart_agent, query_knowledge and query_attachment (CLEAN-84).
 *
 * Local development runs the api on the host rather than in the cluster and
 * overrides this with RANCH_MCP_URL=http://host.k3d.internal:3000/mcp/mcp.
 */
export const DEFAULT_RANCH_MCP_URL =
  'http://ranch-api.platform.svc.cluster.local:3000/mcp/mcp';

export const DEFAULT_CLEANSLICE_MCP_URL = 'https://mcp.cleanslice.org/mcp';

/** A built-in row, minus the fields every one of them shares. */
interface IBuiltInMcpSpec {
  id: string;
  name: string;
  description: string;
  url: string;
  authType: 'bearer' | 'none';
  authValue: string | null;
}

@Injectable()
export class McpServerSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(McpServerSeeder.name);

  constructor(
    private gateway: IMcpServerGateway,
    private config: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    // Operators override with RANCH_MCP_URL. Editing the DB row is not an
    // option for these entries — see ensureBuiltIn.
    const url =
      this.config.get<string>('RANCH_MCP_URL') ?? DEFAULT_RANCH_MCP_URL;

    // The Streamable HTTP endpoint lives at /mcp — the bare origin 404s
    // ("Cannot POST /"), which used to leave every agent with 0 CleanSlice
    // tools and a scary connect-failed line in its startup log.
    const cleansliceUrl =
      this.config.get<string>('CLEANSLICE_MCP_URL') ??
      DEFAULT_CLEANSLICE_MCP_URL;

    // The three api-hosted entries share one endpoint: the registry serves
    // every @Tool the api registers. They stay separate rows so a template
    // can attach one without the others, and so Documents can be injected
    // for every agent by getMcps (CLEAN-67).
    await this.ensureBuiltIn({
      id: RANCH_MCP_ID,
      name: 'Ranch',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes ranch-management tools (list_agents, restart_agent, write_agent_file, ...). Auth uses the agent's RANCH_API_TOKEN.",
      url,
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
    });

    await this.ensureBuiltIn({
      id: KNOWLEDGE_MCP_ID,
      name: 'Knowledge',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes query_knowledge for knowledge bases bound to the calling agent. Auth uses the agent's RANCH_API_TOKEN.",
      url,
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
    });

    await this.ensureBuiltIn({
      id: DOCUMENTS_MCP_ID,
      name: 'Documents',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes query_attachment for spreadsheets attached in chat, so the agent computes sums, counts and lookups from the file instead of estimating. Auth uses the agent's RANCH_API_TOKEN.",
      url,
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
    });

    await this.ensureBuiltIn({
      id: CLEANSLICE_MCP_ID,
      name: 'CleanSlice',
      description:
        'Built-in MCP server hosted at mcp.cleanslice.org. Exposes CleanSlice architecture documentation and helpers (get-started, list-categories, search, read-doc). Auto-attached to every agent.',
      url: cleansliceUrl,
      authType: 'none',
      authValue: null,
    });
  }

  /**
   * Create the row, or converge an existing one on the configured URL.
   *
   * Healing is not a convenience, it is the only repair path that exists.
   * The api owns built-in rows: PATCH /mcp-servers/:id drops everything but
   * `enabled` and `description` for a built-in, and DELETE refuses one
   * outright, so a bad URL cannot be fixed by hand. Without this, a row
   * written once by an older api points at a dead host forever.
   *
   * Only the URL is converged. `enabled` is deliberately left alone, so an
   * operator who switched a built-in off does not find it back on after a
   * deploy.
   *
   * Idempotent: a no-op once the row matches. Agents pick a healed URL up on
   * their next restart, since the MCP list is baked into pod env at creation.
   */
  private async ensureBuiltIn(spec: IBuiltInMcpSpec): Promise<void> {
    const existing = await this.gateway.findById(spec.id);

    if (!existing) {
      await this.gateway.create({
        ...spec,
        transport: 'streamableHttp',
        enabled: true,
        builtIn: true,
      });
      this.logger.log(`Seeded built-in ${spec.name} MCP server at ${spec.url}`);
      return;
    }

    if (existing.url !== spec.url) {
      await this.gateway.update(spec.id, { url: spec.url });
      this.logger.log(
        `Healed built-in ${spec.name} MCP server url: ${existing.url} → ${spec.url}`,
      );
    }
  }
}
