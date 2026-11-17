import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
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
  ILimitChangeResult,
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

/**
 * Origins as the embed check compares them (`allowedOrigins.includes(origin)`
 * in the hub's handshake and in CORS). Tidied the way the console's
 * Access block of the agent Overview does — outer spaces and one trailing slash go,
 * empty entries are skipped — and then held to what an origin is: http or
 * https, a host, an optional port, nothing after it. Stored as a browser
 * sends it (lower-case host, default port left out), because anything else
 * would sit in the list and never match.
 *
 * Returns the first entry it cannot take, so the refusal can name it.
 */
export function normalizeOrigins(
  input: readonly string[],
): { origins: string[] } | { invalid: string } {
  const origins: string[] = [];
  for (const raw of input) {
    const text = raw.trim().replace(/\/$/, '');
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { invalid: raw };
    }
    const bare =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !text.includes('*') &&
      !text.includes('?') &&
      !text.includes('#') &&
      url.pathname === '/' &&
      !url.username &&
      !url.password;
    if (!bare) return { invalid: raw };
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return { origins };
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
 * `set_agent_visibility` mirrors the one save of the console's "Visibility &
 * embed" card (`AgentController.update`): the public flag, the origins and
 * the limits together, limits written first.
 *
 * Audience `admin`, as the routes: Owner and Admin, through the Ranch admin
 * agent or on their own console token (`requireOperator`, CLEAN-232). A
 * plain agent must not read how loaded a colleague is, and certainly must
 * not lift its own ceiling; nor may a User the agent is answering.
 *
 * Results are counts, limit values and visibility, nothing else. The limiter
 * never knew who sent a request, and every result is an explicit copy so that
 * whatever the domain or the agent record grows later does not reach a model
 * by accident.
 */
@ToolAudience('admin')
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
    name: 'list_agent_limits',
    topic: ToolTopics.Agents,
    title: 'List request limits of all agents',
    template:
      'Which agents are at their request limit right now, and which public ones have no limit?',
    description:
      'One line per agent, in one call: its name and id, isPublic, enabled ' +
      '(it has request limits) with the limits per minute, hour and day ' +
      '(null when off), atLimit (a limit is full right now, so the next ' +
      'visitor is refused) and needsLimits (public with no limit at all — ' +
      'offer set_agent_limits). atLimitNow and publicWithoutLimits repeat ' +
      'the names of those two groups. No usage figures here: call ' +
      'get_agent_limits for how busy one agent is.',
    parameters: z.object({}),
  })
  async listAgentLimits(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const agents = await this.agents.findAll();
    // The same call `GET /agent-limits` makes; the name and the values are
    // joined on so the answer can be read out without a second lookup.
    const marks = new Map(
      this.limits.summary(agents).map((mark) => [mark.agentId, mark]),
    );
    const rows = agents.map((agent) => {
      const mark = marks.get(agent.id);
      return {
        agentId: agent.id,
        agentName: agent.name,
        isPublic: agent.isPublic,
        enabled: mark?.enabled ?? false,
        limits: copyLimits(this.limits.getLimits(agent.id)),
        atLimit: mark?.atLimit ?? false,
        needsLimits: mark?.needsLimits ?? false,
      };
    });
    return ok({
      total: rows.length,
      atLimitNow: rows.filter((r) => r.atLimit).map((r) => r.agentName),
      publicWithoutLimits: rows
        .filter((r) => r.needsLimits)
        .map((r) => r.agentName),
      agents: rows,
    });
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
      'hour — in total, by the window that refused them ' +
      '(refusedLastHourByWindow) and when the latest was (lastRefusedAt, ' +
      'null when none is on record) — and the highest minute, hour and day ' +
      `of the last ${PEAK_DAYS} days, the figures to choose a limit from. ` +
      'notCountedLastHour is operator and agent-to-agent traffic: seen, ' +
      'never counted toward a limit and never refused. lastHour.activeMinutes ' +
      'lists only the minutes since lastHour.since that saw any traffic ' +
      '(UTC, oldest first; exempt is that uncounted traffic) — a minute not ' +
      'listed had none, and a burst shows as one large minute. needsLimits ' +
      'true means the agent is public with no limit at all: offer ' +
      'set_agent_limits. Counts only; nothing says who sent a request. ' +
      'Takes the agent id or name.',
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

  @Tool({
    name: 'set_agent_visibility',
    topic: ToolTopics.Agents,
    title: 'Make an agent public or private',
    template:
      'Make the agent «name» public for «site address» with «number» requests per minute',
    destructive: true,
    description:
      'Make an agent public or private, with its allowed origins and its ' +
      'request limits in the same save — what the console’s "Visibility & ' +
      'embed" card does. A public agent is listed on the landing page and ' +
      'anyone on an allowed origin can talk to it without signing in; a ' +
      'private one needs a token from anywhere. allowedOrigins replaces the ' +
      'list (left out: unchanged); each is scheme + host + optional port ' +
      'with no path, e.g. https://shop.example.com — anything else is ' +
      'refused with ORIGIN_INVALID. Limits: leave all three out to keep the ' +
      'current ones; give any of them and the three are replaced together, ' +
      'as in set_agent_limits. A public agent needs at least one limit: ' +
      'making an agent public without one is refused with ' +
      'PUBLIC_AGENT_NEEDS_LIMITS, so pass a limit in the same call ' +
      '(get_agent_limits shows the peaks to choose from); ' +
      'LIMIT_OUT_OF_RANGE and LIMIT_WINDOWS_CONTRADICT apply as well. Every ' +
      'refusal carries a sentence to relay and nothing is saved. The result ' +
      'says whether a restart is suggested — nothing is restarted by this ' +
      'tool; offer restart_agent. Making an agent private or tightening ' +
      'limits needs no confirmation. Making a private agent public, or ' +
      'raising or removing a limit, does: ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agent: AGENT_PARAM,
      isPublic: z
        .boolean()
        .describe('true makes the agent public, false makes it private'),
      allowedOrigins: z
        .array(z.string())
        .optional()
        .describe(
          'Sites allowed to embed the agent without a token, e.g. ' +
            '["https://shop.example.com"]. Replaces the whole list; leave ' +
            'out to keep it.',
        ),
      perMinute: WINDOW_PARAM('per minute'),
      perHour: WINDOW_PARAM('per hour'),
      perDay: WINDOW_PARAM('per day'),
      confirm: z
        .boolean()
        .optional()
        .describe(
          'Needed when a private agent becomes public, or a limit is raised ' +
            'or removed. Set true only after the person confirmed in the chat.',
        ),
    }),
  })
  async setAgentVisibility(
    args: {
      agent: string;
      isPublic: boolean;
      allowedOrigins?: string[];
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
    const asItIs = {
      agentId: agent.id,
      agentName: agent.name,
      isPublic: agent.isPublic,
      limits: copyLimits(current),
    };

    let origins: string[] | undefined;
    if (args.allowedOrigins !== undefined) {
      const parsed = normalizeOrigins(args.allowedOrigins);
      if ('invalid' in parsed) {
        return ok({
          error:
            `«${parsed.invalid}» is not an origin. Give the scheme, the host ` +
            'and, if needed, the port, with no path — for example ' +
            'https://shop.example.com or http://localhost:5173.',
          code: 'ORIGIN_INVALID',
          ...asItIs,
        });
      }
      origins = parsed.origins;
    }

    // Limits are part of this save only when the call names one, exactly as
    // `limits` is part of the route's payload only when the form sends it.
    const namesLimits =
      args.perMinute !== undefined ||
      args.perHour !== undefined ||
      args.perDay !== undefined;
    let change: ILimitChangeResult;
    try {
      // The route's rule, called the way `AgentController.update` calls it.
      change = resolveLimitChange(
        { isPublic: agent.isPublic, limits: current },
        {
          isPublic: args.isPublic,
          ...(namesLimits && {
            limits: {
              perMinute: args.perMinute,
              perHour: args.perHour,
              perDay: args.perDay,
            },
          }),
        },
      );
    } catch (err) {
      if (!(err instanceof LimitRuleError)) throw err;
      return ok({ error: err.message, code: err.code, ...asItIs });
    }

    const becomesPublic = args.isPublic && !agent.isPublic;
    const loosened = change.limitsTouched
      ? loosenedWindows(current, change.limits)
      : [];
    if (becomesPublic || loosened.length > 0) {
      const what: string[] = [];
      if (becomesPublic) {
        what.push(
          `make agent «${agent.name}» public — anyone on an allowed origin ` +
            'can then talk to it without signing in',
        );
      }
      if (loosened.length > 0) {
        what.push(describeLoosening(agent.name, change.limits, loosened));
      }
      const refusal = confirmed(args, what.join(', and '));
      if (refusal) return refusal;
    }

    // Limits first, as the route does: in either direction the agent is then
    // never public without one, not even between the two writes.
    if (change.limitsTouched) {
      await this.limits.setLimits(
        agent.id,
        change.limits,
        httpRequest.user?.sub ?? null,
      );
    }
    const after = await this.agents.update(agent.id, {
      isPublic: args.isPublic,
      ...(origins !== undefined && { allowedOrigins: origins }),
    });
    this.logger.log(
      `Visibility set through MCP: agent=${agent.id} public=${after.isPublic}`,
    );

    const saved = this.limits.getLimits(agent.id);
    const allowedOrigins = [...(after.allowedOrigins ?? [])];
    // What the console's card marks as "restart pending": the public flag or
    // the origins changed. Limits never need one.
    const restartSuggested =
      after.isPublic !== agent.isPublic ||
      allowedOrigins.join('\n') !== (agent.allowedOrigins ?? []).join('\n');

    const sentences = [
      after.isPublic
        ? `Agent «${agent.name}» is public.`
        : `Agent «${agent.name}» is private — a token is required from any origin.`,
    ];
    if (after.isPublic && allowedOrigins.length === 0) {
      sentences.push(
        'No allowed origin is set, so no site can embed it yet — pass allowedOrigins.',
      );
    }
    if (after.isPublic && saved === null) {
      sentences.push(
        'It has no request limit — set one with set_agent_limits.',
      );
    } else if (change.limitsTouched) {
      sentences.push(
        saved
          ? 'Its request limits are saved and apply from the next request.'
          : 'Its request limits are off.',
      );
    }
    if (restartSuggested) {
      sentences.push(
        'The API uses the new visibility for new connections (allowed ' +
          'origins can take half a minute to reach the embed). The console ' +
          'marks an agent for a restart after this change. Nothing was ' +
          `restarted — offer restart_agent with id=${agent.id}.`,
      );
    }

    return ok({
      ok: true,
      agentId: agent.id,
      agentName: agent.name,
      isPublic: after.isPublic,
      allowedOrigins,
      enabled: saved !== null,
      limits: copyLimits(saved),
      restartSuggested,
      message: sentences.join(' '),
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

function copyLimits(limits: IAgentLimits | null): IAgentLimits | null {
  return limits
    ? {
        perMinute: limits.perMinute,
        perHour: limits.perHour,
        perDay: limits.perDay,
      }
    : null;
}

/** Start of a minute as a model reads it: UTC, to the minute. */
const minuteLabel = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 16)}Z`;

/**
 * The operator's view of one agent, as counts. An explicit copy: nothing the
 * snapshot carries now or later goes along by default. The console draws the
 * last hour as sixty bars; here only the minutes that saw traffic are listed,
 * because sixty rows of zeros cost a model more than they tell it.
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
    limits: copyLimits(snapshot.limits),
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
    refusedLastHourByWindow: {
      minute: snapshot.refused.byWindow.minute,
      hour: snapshot.refused.byWindow.hour,
      day: snapshot.refused.byWindow.day,
    },
    lastRefusedAt: snapshot.refused.lastAt,
    notCountedLastHour: snapshot.exemptLastHour,
    lastHour: {
      since: snapshot.series.length
        ? minuteLabel(snapshot.series[0].minute)
        : null,
      activeMinutes: snapshot.series
        .filter((m) => m.accepted > 0 || m.refused > 0 || m.exempt > 0)
        .map((m) => ({
          minute: minuteLabel(m.minute),
          accepted: m.accepted,
          refused: m.refused,
          exempt: m.exempt,
        })),
    },
    peaksLast30Days: {
      minute: snapshot.peaks.minute,
      hour: snapshot.peaks.hour,
      day: snapshot.peaks.day,
    },
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}
