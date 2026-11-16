import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import { IAgentData, IAgentGateway } from '#/agent/agent/domain';
import { IAuthTokenPayload } from '#/user/auth/domain';
import {
  AgentLimitService,
  IAgentLimits,
  IAgentLoadSnapshot,
  LIMIT_MAX,
  LimitRuleError,
  PEAK_DAYS,
  hasAnyLimit,
  resolveLimitChange,
} from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const FIELDS: ReadonlyArray<[keyof IAgentLimits, string]> = [
  ['perMinute', 'per minute'],
  ['perHour', 'per hour'],
  ['perDay', 'per day'],
];

export interface ILoosenedWindow {
  field: keyof IAgentLimits;
  from: number;
  /** null when the window loses its limit altogether. */
  to: number | null;
}

/**
 * The windows a change lets more through: a limit that is raised, or removed.
 * Empty when limits are set for the first time, only lowered, or added to a
 * window that had none — none of those can let in a request that the current
 * limits would have refused.
 */
export function loosenedWindows(
  current: IAgentLimits | null,
  next: IAgentLimits | null,
): ILoosenedWindow[] {
  if (!current) return [];
  const loosened: ILoosenedWindow[] = [];
  for (const [field] of FIELDS) {
    const from = current[field];
    const to = next ? next[field] : null;
    if (from === null) continue;
    if (to === null || to > from) loosened.push({ field, from, to });
  }
  return loosened;
}

/** The change in the words the person will be asked to confirm. */
function describeLoosening(
  agentName: string,
  next: IAgentLimits | null,
  loosened: ILoosenedWindow[],
): string {
  if (!hasAnyLimit(next)) {
    return (
      `switch request limits off for agent «${agentName}» — it will then ` +
      'take any number of requests'
    );
  }
  const label = new Map(FIELDS);
  const parts = loosened.map(({ field, from, to }) =>
    to === null
      ? `remove the limit ${label.get(field)} (now ${from})`
      : `raise the limit ${label.get(field)} from ${from} to ${to}`,
  );
  return `${parts.join(' and ')} for agent «${agentName}»`;
}

const AGENT_PARAM = z
  .string()
  .describe('Agent id (e.g. agent-abc123) or its exact name');

const WINDOW_PARAM = (label: string) =>
  z
    .number()
    .nullable()
    .optional()
    .describe(
      `Requests allowed ${label}, a whole number from 1; null or left out ` +
        'means this window has no limit',
    );

/**
 * Request limits of an agent, from the chat (CLEAN-224). Mirrors
 * `AgentLimitController`: the same `AgentLimitService`, the same
 * `resolveLimitChange` rule, the same actor recorded on a save.
 *
 * Operator-only, like the routes (Owner and Admin in the console; the Ranch
 * admin agent holds Owner). A plain agent must not read how loaded a colleague
 * is, and certainly must not lift its own ceiling.
 *
 * Results are counts and nothing else. The limiter never knew who sent a
 * request, and the read copies the snapshot field by field so that whatever
 * the domain grows later does not reach a model by accident.
 */
@Injectable()
export class AgentLimitTool implements IConditionallyListedTool {
  private readonly logger = new Logger(AgentLimitTool.name);

  constructor(
    private readonly limits: AgentLimitService,
    private readonly agents: IAgentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_agent_limits',
    topic: ToolTopics.Agents,
    title: 'Show request limits and load',
    template:
      'What are the request limits of the agent «name», and how busy is it?',
    description:
      'The request limits of one agent and how loaded it is right now: the ' +
      'limits per minute, hour and day (null when limits are off), how much ' +
      'of each window is used and the seconds until a full one has room ' +
      'again, the requests in progress, how many were refused in the last ' +
      `hour, and the highest minute, hour and day of the last ${PEAK_DAYS} ` +
      'days — the figures to choose a limit from. needsLimits true means the ' +
      'agent is public with no limit at all: offer set_agent_limits. Counts ' +
      'only; nothing says who sent a request. Takes the agent id or name.',
    parameters: z.object({ agent: AGENT_PARAM }),
  })
  async getAgentLimits(
    { agent: ref }: { agent: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const found = await this.resolveAgent(ref);
    if ('refusal' in found) return found.refusal;
    const { agent } = found;
    return ok(present(agent, await this.limits.snapshot(agent)));
  }

  @Tool({
    name: 'set_agent_limits',
    topic: ToolTopics.Agents,
    title: 'Set request limits',
    template:
      'Limit the agent «name» to «number» requests per minute and «number» per day',
    destructive: true,
    description:
      'Set how many requests an agent accepts per minute, per hour and per ' +
      'day — one allowance shared by everyone who talks to it. The three ' +
      'values replace the current ones together: a window left out or null ' +
      'has no limit, so repeat the values that should stay (get_agent_limits ' +
      'has them); all three empty switches limits off. Takes effect on the ' +
      'next request and keeps what was used so far. Refused, with a code and ' +
      'a sentence to relay, when a value is not a whole number from 1 to ' +
      `${LIMIT_MAX} (LIMIT_OUT_OF_RANGE), when a longer window allows less than a ` +
      'shorter one (LIMIT_WINDOWS_CONTRADICT), or when a public agent would ' +
      'be left with no limit (PUBLIC_AGENT_NEEDS_LIMITS). Setting limits for ' +
      'the first time or lowering them needs no confirmation. Raising or ' +
      'removing any limit does: ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agent: AGENT_PARAM,
      perMinute: WINDOW_PARAM('per minute'),
      perHour: WINDOW_PARAM('per hour'),
      perDay: WINDOW_PARAM('per day'),
      confirm: z
        .boolean()
        .optional()
        .describe(
          'Needed only when a limit is raised or removed. Set true only ' +
            'after the person confirmed in the chat.',
        ),
    }),
  })
  async setAgentLimits(
    args: {
      agent: string;
      perMinute?: number | null;
      perHour?: number | null;
      perDay?: number | null;
      confirm?: boolean;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const found = await this.resolveAgent(args.agent);
    if ('refusal' in found) return found.refusal;
    const { agent } = found;

    const current = this.limits.getLimits(agent.id);
    let next: IAgentLimits | null;
    try {
      // The route's rule, called the way the route calls it.
      next = resolveLimitChange(
        { isPublic: agent.isPublic, limits: current },
        {
          limits: {
            perMinute: args.perMinute,
            perHour: args.perHour,
            perDay: args.perDay,
          },
        },
      ).limits;
    } catch (err) {
      if (!(err instanceof LimitRuleError)) throw err;
      return ok({
        error: err.message,
        code: err.code,
        agentId: agent.id,
        agentName: agent.name,
        limits: current,
      });
    }

    const loosened = loosenedWindows(current, next);
    if (loosened.length > 0) {
      const refusal = confirmed(
        args,
        describeLoosening(agent.name, next, loosened),
      );
      if (refusal) return refusal;
    }

    await this.limits.setLimits(agent.id, next, httpRequest.user?.sub ?? null);
    this.logger.log(`Request limits set through MCP: agent=${agent.id}`);

    const saved = this.limits.getLimits(agent.id);
    return ok({
      ok: true,
      agentId: agent.id,
      agentName: agent.name,
      enabled: saved !== null,
      limits: saved,
      message: saved
        ? `Request limits of agent «${agent.name}» saved — they apply from the next request.`
        : `Request limits of agent «${agent.name}» are off.`,
    });
  }

  /**
   * By id first, then by exact name (case and outer spaces aside). A name two
   * agents share is not guessed at: a limit on the wrong agent is a public
   * agent left open or a busy one shut.
   */
  private async resolveAgent(
    ref: string,
  ): Promise<{ agent: IAgentData } | { refusal: ToolResult }> {
    const byId = await this.agents.findById(ref);
    if (byId) return { agent: byId };

    const wanted = ref.trim().toLowerCase();
    const named = wanted
      ? (await this.agents.findAll()).filter(
          (a) => a.name.trim().toLowerCase() === wanted,
        )
      : [];
    if (named.length === 1) return { agent: named[0] };
    if (named.length > 1) {
      return {
        refusal: ok({
          error:
            `${named.length} agents are named «${ref}» ` +
            `(${named.map((a) => a.id).join(', ')}) — call again with the id`,
        }),
      };
    }
    return {
      refusal: ok({
        error: `Agent ${ref} not found — call list_agents to find the id`,
      }),
    };
  }
}

/**
 * The operator's view of one agent, as counts. An explicit copy: the
 * minute-by-minute series is a chart, not something to read out, and nothing
 * else the snapshot carries now or later goes along by default.
 */
function present(
  agent: { id: string; name: string },
  snapshot: IAgentLoadSnapshot,
): Record<string, unknown> {
  const notes: string[] = [];
  if (snapshot.needsLimits) {
    notes.push(
      'This agent is public and has no request limit — set one with set_agent_limits.',
    );
  }
  if (snapshot.apiReplicas > 1) {
    notes.push(
      `${snapshot.apiReplicas} copies of the API are live and each counts on ` +
        'its own, so these figures are one share of the real load.',
    );
  }
  return {
    agentId: agent.id,
    agentName: agent.name,
    enabled: snapshot.limits !== null,
    limits: snapshot.limits
      ? {
          perMinute: snapshot.limits.perMinute,
          perHour: snapshot.limits.perHour,
          perDay: snapshot.limits.perDay,
        }
      : null,
    isPublic: snapshot.isPublic,
    needsLimits: snapshot.needsLimits,
    windows: snapshot.windows.map((w) => ({
      window: w.window,
      used: w.used,
      limit: w.limit,
      secondsUntilRoom: w.retryAfterSec,
    })),
    inProgress: snapshot.inFlight,
    refusedLastHour: snapshot.refused.lastHour,
    peaksLast30Days: {
      minute: snapshot.peaks.minute,
      hour: snapshot.peaks.hour,
      day: snapshot.peaks.day,
    },
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}
