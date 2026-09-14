import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMcpServerGateway } from './mcpServer.gateway';

export const RANCH_MCP_ID = 'mcp-ranch';
export const KNOWLEDGE_MCP_ID = 'mcp-knowledge';
export const CLEANSLICE_MCP_ID = 'mcp-cleanslice';
export const DOCUMENTS_MCP_ID = 'mcp-documents';

/**
 * The address every deployment was seeded with before this fix. It names a
 * host and a port that exist nowhere — not in the cluster, where the api
 * Service is `ranch-api` in `platform`, and not in the k3d local setup, whose
 * CoreDNS only aliases host.k3d.internal. Agents failed to connect and
 * silently lost list_agents, restart_agent, query_knowledge and
 * query_attachment (CLEAN-84).
 *
 * Kept as a constant because it is the *only* value healing will overwrite —
 * see ensureBuiltIn.
 */
export const LEGACY_RANCH_MCP_URL = 'http://api:3001/mcp/mcp';

/**
 * In-cluster address of this api's own MCP endpoint.
 *
 * The cross-namespace form is required: agent pods run in `agents`, the api
 * in `platform`. The port is deliberately left off, matching the address that
 * answers in the live cluster today — the Ranch and Knowledge rows were
 * corrected to it by hand and their endpoint responds (401 without a token,
 * 400 for a missing session), which is what a reachable MCP endpoint looks
 * like.
 *
 * Note `k8s/platform/api/service.yaml` in this repo declares port 3000. A
 * deployment where that is the only port needs
 * RANCH_MCP_URL=http://ranch-api.platform.svc.cluster.local:3000/mcp/mcp;
 * local development, which runs the api on the host, needs
 * RANCH_MCP_URL=http://host.k3d.internal:3000/mcp/mcp.
 */
export const DEFAULT_RANCH_MCP_URL =
  'http://ranch-api.platform.svc.cluster.local/mcp/mcp';

export const DEFAULT_CLEANSLICE_MCP_URL = 'https://mcp.cleanslice.org/mcp';

/** A built-in row, minus the fields every one of them shares. */
interface IBuiltInMcpSpec {
  id: string;
  name: string;
  description: string;
  url: string;
  authType: 'bearer' | 'none';
  authValue: string | null;
  /**
   * Overwrite an existing row's url only when it holds one of these. Absent
   * means converge unconditionally.
   */
  healOnlyFrom?: readonly string[];
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
    //
    // healOnlyFrom is what keeps this fix safe to deploy. Operators have
    // already corrected some of these rows by hand — the Ranch and Knowledge
    // entries in production point at a working address that is NOT this
    // default. Converging every row on one value would overwrite a working
    // endpoint with an untested one. Only the known-dead legacy address is
    // ever replaced; anything else an operator put there is left alone.
    const apiHosted = {
      url,
      authType: 'bearer',
      authValue: '${RANCH_API_TOKEN}',
      healOnlyFrom: [LEGACY_RANCH_MCP_URL],
    } as const;

    await this.ensureBuiltIn({
      id: RANCH_MCP_ID,
      name: 'Ranch',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes ranch-management tools (list_agents, restart_agent, write_agent_file, ...). Auth uses the agent's RANCH_API_TOKEN.",
      ...apiHosted,
    });

    await this.ensureBuiltIn({
      id: KNOWLEDGE_MCP_ID,
      name: 'Knowledge',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes query_knowledge for knowledge bases bound to the calling agent. Auth uses the agent's RANCH_API_TOKEN.",
      ...apiHosted,
    });

    await this.ensureBuiltIn({
      id: DOCUMENTS_MCP_ID,
      name: 'Documents',
      description:
        "Built-in MCP server hosted by this Ranch's own API. Exposes query_attachment for spreadsheets attached in chat, so the agent computes sums, counts and lookups from the file instead of estimating. Auth uses the agent's RANCH_API_TOKEN.",
      ...apiHosted,
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
   * Create the row, or repair an existing one.
   *
   * Repair is not a convenience, it is the only path there is. The api owns
   * built-in rows: PATCH /mcp-servers/:id drops everything but `enabled` and
   * `description` for a built-in, and DELETE refuses one outright, so a bad
   * URL cannot be fixed through the product at all.
   *
   * `healOnlyFrom` narrows that power to the addresses we know are dead. An
   * operator who has already put a working URL on a row — by hand, in the
   * database, because the api left them no other way — must not have it
   * replaced by a value this code merely believes in. Overwriting a working
   * endpoint is a worse failure than leaving a stale one, because it breaks
   * something that was serving traffic.
   *
   * `enabled` is never touched either, so a built-in switched off on purpose
   * does not come back after a deploy.
   *
   * Idempotent: a no-op once the row matches. Agents pick a repaired URL up
   * on their next restart, since the MCP list is baked into pod env at
   * creation.
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

    if (existing.url === spec.url) return;

    if (spec.healOnlyFrom && !spec.healOnlyFrom.includes(existing.url)) {
      this.logger.log(
        `Left built-in ${spec.name} MCP server on its configured url ${existing.url} ` +
          `(not the known-dead address, so not ours to overwrite)`,
      );
      return;
    }

    await this.gateway.update(spec.id, { url: spec.url });
    this.logger.log(
      `Healed built-in ${spec.name} MCP server url: ${existing.url} → ${spec.url}`,
    );
  }
}
