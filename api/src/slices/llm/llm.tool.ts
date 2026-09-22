import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  CONFIRM_SENTENCE,
  callerIsOperator,
  confirmed,
  err,
  ok,
  requireOperator,
  stripSecrets,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { IUsageGateway, costUsd } from '#/usage/domain';
import type {
  ICredentialUsageResponse,
  IUsageDailyEntry,
  IUsageData,
} from '#/usage/domain';
import {
  ILlmGateway,
  ILlmHealthGateway,
  normalizeCredential,
  type ILlmCredentialData,
  type IUpdateLlmCredentialData,
} from './domain';
import { LLM_PROVIDERS, findLlmProvider } from './domain/providers';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** The usage endpoints look back this far; the tool answers the same window. */
const USAGE_DAYS = 30;

const NOT_FOUND = 'LLM credential not found — call list_llms to find the id.';

const STATUS = z.enum(['active', 'disabled']);

/**
 * LLM credentials from the chat, for the operator agent (CLEAN-109). Each
 * tool mirrors one route of `LlmController` (and `GET llms/:id/usage` of
 * `UsageController`) and calls the same gateways, so nothing about
 * credential normalisation or health-checking is re-implemented here.
 *
 * The one rule this file owns is FR-004: a key goes in and never comes out.
 * Every row passes through `stripSecrets` before it becomes tool text, and
 * "set" operations acknowledge without echoing what was set.
 *
 * Operator agents only: a plain agent has no business reading which models
 * the Ranch pays for, let alone deleting the credential it runs on.
 */
@Injectable()
export class LlmTool implements IConditionallyListedTool {
  private readonly logger = new Logger(LlmTool.name);

  /**
   * Usage and agent gateways come from `ModuleRef` rather than the
   * constructor: LlmModule is a leaf that Chat, Usage, Workflow and
   * Knowledge import plainly while AgentModule is still loading, so an
   * `imports: [UsageModule, AgentModule]` here — forwardRef or not — leaves
   * `undefined` in ChatModule's and UsageModule's imports at boot. Resolving
   * the two tokens at call time keeps the module graph as it is.
   */
  constructor(
    private readonly llms: ILlmGateway,
    private readonly health: ILlmHealthGateway,
    private readonly moduleRef: ModuleRef,
  ) {}

  private get usage(): IUsageGateway {
    return this.moduleRef.get(IUsageGateway, { strict: false });
  }

  private get agents(): IAgentGateway {
    return this.moduleRef.get(IAgentGateway, { strict: false });
  }

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'get_llm',
    topic: ToolTopics.Llm,
    title: 'Show a credential',
    template: 'Show the LLM credential «name»',
    description:
      'One LLM credential: provider, model, fallback model, label, status and ' +
      'which capabilities (chat, embedding) it is registered for. The key is ' +
      'never returned. Takes the id — list_llms turns a name into one.',
    parameters: z.object({
      id: z.string().describe('Credential id, from list_llms'),
    }),
  })
  async getLlm(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const record = await this.llms.findById(id);
    if (!record) return ok({ error: NOT_FOUND });
    return ok(stripSecrets(record));
  }

  @Tool({
    name: 'list_llm_models',
    topic: ToolTopics.Llm,
    title: 'List known models',
    template: 'Which models can I use with «provider»?',
    description:
      'The providers and models Ranch knows: for each, the model ids to put ' +
      'in create_llm or update_llm and whether it does chat or embeddings. ' +
      'Optional provider filter (claude/anthropic, openai). A credential may ' +
      'still name a model that is not listed — this is what Ranch vouches ' +
      'for, not a whitelist.',
    parameters: z.object({
      provider: z
        .string()
        .optional()
        .describe('Only this provider, e.g. "claude" or "openai"'),
    }),
  })
  async listLlmModels(
    { provider }: { provider?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    if (provider !== undefined) {
      const found = findLlmProvider(provider);
      if (!found) {
        return ok({
          error:
            `Unknown provider «${provider}» — known: ` +
            LLM_PROVIDERS.map((p) => `${p.id} (${p.label})`).join(', ') +
            '.',
        });
      }
      return ok({ providers: [found] });
    }
    return ok({ providers: LLM_PROVIDERS });
  }

  @Tool({
    name: 'llm_usage',
    topic: ToolTopics.Llm,
    title: 'Usage of a credential',
    template: 'How much did the credential «name» cost in the last 30 days?',
    description:
      'Token usage and estimated cost of one LLM credential over the last 30 ' +
      'days, across every agent that used it: a daily breakdown per model, ' +
      'totals, the model that consumed most, and a per-agent split sorted by ' +
      'cost. Only usage the agents have reported (daily); today may be ' +
      'incomplete. Takes the id — list_llms turns a name into one.',
    parameters: z.object({
      id: z.string().describe('Credential id, from list_llms'),
    }),
  })
  async llmUsage(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const credential = await this.llms.findById(id);
    if (!credential) return ok({ error: NOT_FOUND });
    const rows = await this.usage.findRecentForCredential(id, USAGE_DAYS);
    const { last30days, totals, topModel, agentTotals } =
      rollUpAcrossAgents(rows);
    const byAgent = await this.resolveAgentNames(agentTotals);
    return ok({
      credential: describe(credential),
      days: USAGE_DAYS,
      last30days,
      totals,
      topModel,
      byAgent,
    });
  }

  // ─── Changing ────────────────────────────────────────────────────────

  @Tool({
    name: 'create_llm',
    topic: ToolTopics.Llm,
    title: 'Create a credential',
    template: 'Create an LLM credential «name» for «provider» with key «key»',
    description:
      'Register an API key for a provider and model, so agents can be ' +
      'pointed at it (update_agent with llmCredentialId). Pass the key ' +
      'exactly as the person gave it — a pasted `NAME=` prefix or quotes ' +
      'are stripped, as the console does. Returns the new row without the ' +
      'key; health_check_llm tells whether it actually works. ' +
      'list_llm_models has the model ids.',
    parameters: z.object({
      provider: z.string().describe('Provider id, e.g. "claude" or "openai"'),
      model: z.string().describe('Model id, e.g. "claude-sonnet-4-6"'),
      apiKey: z.string().describe('The API key. Stored, never read back.'),
      fallbackModel: z
        .string()
        .optional()
        .describe('Model to fall back to when the main one is unavailable'),
      label: z.string().optional().describe('Human name for the credential'),
      status: STATUS.optional().describe('Default active'),
      supportsChat: z.boolean().optional().describe('Default true'),
      supportsEmbedding: z.boolean().optional().describe('Default false'),
    }),
  })
  async createLlm(
    args: {
      provider: string;
      model: string;
      apiKey: string;
      fallbackModel?: string;
      label?: string;
      status?: 'active' | 'disabled';
      supportsChat?: boolean;
      supportsEmbedding?: boolean;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const created = await this.llms.create({
      ...args,
      // The DTO normalises a pasted `.env` line before persisting; the tool
      // must too, or the same paste works in the console and fails here.
      apiKey: normalizeCredential(args.apiKey),
    });
    this.logger.log(
      `LLM credential created through MCP: ${created.id} ${created.provider}/${created.model}`,
    );
    return ok({
      created: stripSecrets(created),
      note:
        'The key is stored and will not be shown again. Call ' +
        `health_check_llm with id=${created.id} to verify it works.`,
    });
  }

  @Tool({
    name: 'update_llm',
    topic: ToolTopics.Llm,
    title: 'Update a credential',
    template: 'Change the LLM credential «name»: «what to change»',
    description:
      'Change any field of a credential: provider, model, fallback model, ' +
      'label, status (active/disabled) or capabilities, or replace the key. ' +
      'Only the fields passed change. Returns the row without the key. ' +
      'Agents already running keep the old values until restarted ' +
      '(restart_agent).',
    parameters: z.object({
      id: z.string().describe('Credential id, from list_llms'),
      provider: z.string().optional(),
      model: z.string().optional(),
      apiKey: z
        .string()
        .optional()
        .describe('New API key. Stored, never read back.'),
      fallbackModel: z
        .string()
        .nullable()
        .optional()
        .describe('null clears it'),
      label: z.string().nullable().optional().describe('null clears it'),
      status: STATUS.optional(),
      supportsChat: z.boolean().optional(),
      supportsEmbedding: z.boolean().optional(),
    }),
  })
  async updateLlm(
    {
      id,
      ...changes
    }: { id: string } & {
      provider?: string;
      model?: string;
      apiKey?: string;
      fallbackModel?: string | null;
      label?: string | null;
      status?: 'active' | 'disabled';
      supportsChat?: boolean;
      supportsEmbedding?: boolean;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const existing = await this.llms.findById(id);
    if (!existing) return ok({ error: NOT_FOUND });
    // Only what was passed: prisma would treat an explicit undefined as
    // "leave alone" anyway, but the `changed` list below must be honest.
    const data = Object.fromEntries(
      Object.entries(changes).filter(([, v]) => v !== undefined),
    ) as IUpdateLlmCredentialData;
    if (data.apiKey !== undefined) {
      data.apiKey = normalizeCredential(data.apiKey);
    }
    if (Object.keys(data).length === 0) {
      return err('Nothing to change — pass at least one field besides id.');
    }
    const updated = await this.llms.update(id, data);
    this.logger.log(
      `LLM credential updated through MCP: ${id} fields=${Object.keys(data).join(',')}`,
    );
    return ok({
      updated: stripSecrets(updated),
      changed: Object.keys(data),
      ...(data.apiKey !== undefined
        ? { note: 'The key was replaced and will not be shown.' }
        : {}),
    });
  }

  @Tool({
    name: 'delete_llm',
    topic: ToolTopics.Llm,
    title: 'Delete a credential',
    template: 'Delete the LLM credential «name»',
    destructive: true,
    description:
      'Remove an LLM credential. Agents that use it are left without one ' +
      'and will fail to start until update_agent points them at another; ' +
      'the tool names them before asking. The key is gone for good — there ' +
      'is no other copy. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('Credential id, from list_llms'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteLlm(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { id } = args;
    const credential = await this.llms.findById(id);
    if (!credential) return ok({ error: NOT_FOUND });

    // Name the agents that would be orphaned in the confirmation itself, so
    // the person says yes to the real consequence, not to an id.
    const users = (await this.agents.findAll()).filter(
      (a) => a.llmCredentialId === id,
    );
    const name = displayName(credential);
    const inUse =
      users.length > 0
        ? `, which ${users.length === 1 ? 'agent' : 'agents'} ` +
          `${users.map((a) => `«${a.name}»`).join(', ')} still ` +
          `${users.length === 1 ? 'uses' : 'use'} — ` +
          `${users.length === 1 ? 'it' : 'they'} would be left without a model`
        : '';
    const refusal = confirmed(
      args,
      `delete the LLM credential ${name} (${id})${inUse}`,
    );
    if (refusal) return refusal;

    try {
      await this.llms.delete(id);
    } catch (e) {
      // The schema unlinks agents and usage rows on delete, so a foreign-key
      // refusal means a reference this tool does not know about. Say so
      // rather than hand the model a Prisma stack.
      if ((e as { code?: string }).code === 'P2003') {
        return err(
          `The credential ${name} is still referenced and the database ` +
            'refused to delete it. Point everything that uses it elsewhere ' +
            'first (list_agents shows llmCredentialId), then try again.',
        );
      }
      throw e;
    }
    this.logger.log(`LLM credential deleted through MCP: ${id}`);
    return ok(
      `LLM credential ${name} (${id}) deleted.` +
        (users.length > 0
          ? ` ${users.map((a) => `«${a.name}» (${a.id})`).join(', ')} ` +
            'now ' +
            `${users.length === 1 ? 'has' : 'have'} no credential: assign ` +
            'another with update_agent (llmCredentialId) and restart_agent.'
          : ''),
    );
  }

  @Tool({
    name: 'health_check_llm',
    topic: ToolTopics.Llm,
    title: 'Health-check a credential',
    template: 'Check that the LLM credential «name» works',
    description:
      'Send a one-token request to the provider with this credential and ' +
      'report whether it answered, how long it took, and the provider error ' +
      'if not (an invalid key, an unknown model, a provider Ranch cannot ' +
      'check). Costs one tiny call. Takes the id — list_llms turns a name ' +
      'into one.',
    parameters: z.object({
      id: z.string().describe('Credential id, from list_llms'),
    }),
  })
  async healthCheckLlm(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const credential = await this.llms.findById(id);
    if (!credential) return ok({ error: NOT_FOUND });
    const result = await this.health.check(credential);
    // The result carries no key by design; the provider's error text is the
    // one field we do not author, so scrub the key from it just in case.
    const error =
      result.error && credential.apiKey
        ? result.error.split(credential.apiKey).join('[redacted]')
        : result.error;
    return ok({
      ...result,
      ...(error !== undefined ? { error } : {}),
      credential: describe(credential),
    });
  }

  /** As `UsageController.resolveAgentNames`: a deleted agent keeps its id. */
  private async resolveAgentNames(
    agentTotals: IAgentTotals[],
  ): Promise<ICredentialUsageResponse['byAgent']> {
    return Promise.all(
      agentTotals.map(async (entry) => {
        const agent = await this.agents
          .findById(entry.agentId)
          .catch(() => null);
        return { ...entry, agentName: agent?.name ?? entry.agentId };
      }),
    );
  }
}

/** The public identity of a credential, for headers and sentences. */
function describe(c: ILlmCredentialData) {
  return {
    id: c.id,
    provider: c.provider,
    model: c.model,
    label: c.label,
    status: c.status,
  };
}

function displayName(c: ILlmCredentialData): string {
  return `«${c.label ?? `${c.provider}/${c.model}`}»`;
}

interface IAgentTotals {
  agentId: string;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

interface ITotals {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  costUsd: number;
}

/**
 * The same roll-up `UsageController.rollUpAcrossAgents` does for
 * `GET llms/:id/usage`: daily rows at `${date}|${model}` grain, totals, the
 * model with the most tokens, and per-agent totals sorted by cost. Kept in
 * step with the controller by hand — it is private there, and this slice
 * cannot import the usage controller.
 */
function rollUpAcrossAgents(rows: IUsageData[]): {
  last30days: IUsageDailyEntry[];
  totals: ITotals;
  topModel: string | null;
  agentTotals: IAgentTotals[];
} {
  const daily = new Map<string, IUsageDailyEntry>();
  const perAgent = new Map<string, IAgentTotals>();
  const perModelTokens = new Map<string, number>();

  for (const r of rows) {
    const date = r.date.toISOString().slice(0, 10);
    const cost = costUsd(r.model, r.inputTokens, r.outputTokens);

    const key = `${date}|${r.model}`;
    const day = daily.get(key) ?? {
      date,
      model: r.model,
      inputTokens: 0,
      outputTokens: 0,
      callCount: 0,
      costUsd: 0,
    };
    day.inputTokens += r.inputTokens;
    day.outputTokens += r.outputTokens;
    day.callCount += r.callCount;
    day.costUsd += cost;
    daily.set(key, day);

    const agent = perAgent.get(r.agentId) ?? {
      agentId: r.agentId,
      inputTokens: 0,
      outputTokens: 0,
      callCount: 0,
      costUsd: 0,
    };
    agent.inputTokens += r.inputTokens;
    agent.outputTokens += r.outputTokens;
    agent.callCount += r.callCount;
    agent.costUsd += cost;
    perAgent.set(r.agentId, agent);

    perModelTokens.set(
      r.model,
      (perModelTokens.get(r.model) ?? 0) + r.inputTokens + r.outputTokens,
    );
  }

  const last30days = [...daily.values()].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
  const totals = last30days.reduce<ITotals>(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      callCount: acc.callCount + e.callCount,
      costUsd: acc.costUsd + e.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, callCount: 0, costUsd: 0 },
  );

  let topModel: string | null = null;
  let topTokens = -1;
  for (const [model, tokens] of perModelTokens) {
    if (tokens > topTokens) {
      topTokens = tokens;
      topModel = model;
    }
  }

  const agentTotals = [...perAgent.values()].sort(
    (a, b) => b.costUsd - a.costUsd,
  );
  return { last30days, totals, topModel, agentTotals };
}
