import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import {
  AgentEventService,
  EVENT_PAGE_DEFAULT,
  EVENT_PAGE_MAX,
  IAgentEventData,
  IAgentIncidentView,
  INotificationDestinationView,
  NotificationDestinationService,
} from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Rows as tool results, field by field. A whitelist rather than a strip of
 * known secret names: the one thing nothing here may carry is the
 * destination's address, and a service that someday returns more than it
 * should must not get a say.
 */
function toToolEvent(e: IAgentEventData) {
  return {
    id: e.id,
    agentId: e.agentId,
    agentRef: e.agentRef,
    agentName: e.agentName,
    status: e.status,
    reason: e.reason,
    witness: e.witness,
    senderName: e.senderName,
    tool: e.tool,
    ranchStatus: e.ranchStatus,
    outcome: e.outcome,
    incidentId: e.incidentId,
    occurredAt: iso(e.occurredAt),
    receivedAt: iso(e.receivedAt),
  };
}

function toToolIncident(i: IAgentIncidentView) {
  return {
    id: i.id,
    agentId: i.agentId,
    agentName: i.agentName,
    state: i.open ? 'open' : 'closed',
    status: i.status,
    reason: i.reason,
    witnesses: i.witnesses,
    ranchWitnessed: i.ranchWitnessed,
    eventCount: i.eventCount,
    openedAt: iso(i.openedAt),
    lastFailureAt: iso(i.lastFailureAt),
    upSince: iso(i.upSince),
    closedAt: iso(i.closedAt),
    resolution: i.resolution,
    notifications: (i.notifications ?? []).map((n) => ({
      kind: n.kind,
      status: n.status,
      attempts: n.attempts,
      sentAt: iso(n.sentAt),
      lastError: n.lastError,
    })),
  };
}

function toToolDestination(v: INotificationDestinationView) {
  return {
    configured: v.configured,
    kind: v.kind,
    hint: v.hint,
    updatedBy: v.updatedBy,
    updatedAt: iso(v.updatedAt),
    consoleLinks: v.consoleLinks,
    lastDelivery: v.lastDelivery
      ? {
          at: iso(v.lastDelivery.at),
          ok: v.lastDelivery.ok,
          error: v.lastDelivery.error,
        }
      : null,
  };
}

const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(EVENT_PAGE_MAX)
  .optional()
  .describe(
    `How many to return, newest first (default ${EVENT_PAGE_DEFAULT}).`,
  );

const sinceSchema = z
  .string()
  .optional()
  .describe(
    'Only what happened at or after this moment, ISO 8601 (e.g. 2026-10-06T00:00:00Z).',
  );

function parseSince(value: string | undefined): Date | null | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

const BAD_SINCE = ok({
  error:
    'since is not a date I can read — use ISO 8601, e.g. 2026-10-06T00:00:00Z',
});

/**
 * The Events page and the Notifications settings page from the chat
 * (CLEAN-139): what went down, when, who saw it, whether the team was told,
 * and where they are told. Every call goes through the services the two
 * controllers inject, so a rule lives in one place.
 *
 * Operator agents only. `requireOperator` passes a caller that holds the
 * Owner role and nobody else — an Admin is refused — so the three tools that
 * set, test or remove the destination ask for exactly what the controller's
 * `@Roles(Owner)` asks for; the two listings are stricter here than in the
 * console, where an Admin may read. No result carries the destination's
 * address: it goes in through `set_notification_destination` and is never
 * read back.
 */
@Injectable()
export class AgentEventTool implements IConditionallyListedTool {
  private readonly logger = new Logger(AgentEventTool.name);

  constructor(
    private service: AgentEventService,
    private destinations: NotificationDestinationService,
    private agents: IAgentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'list_agent_events',
    topic: ToolTopics.Agents,
    title: 'List agent events',
    template: 'Show what happened to «agent name» since «when»',
    description:
      'Agent events, newest first: failure reports from outside senders and ' +
      'failures Ranch noticed itself. Each has the agent, the status, the ' +
      'cause as it was reported, who witnessed it (senderName; "Ranch" for ' +
      "Ranch's own watch), what Ranch held for the agent at that moment, and " +
      'the outcome — whether it opened an incident, joined one, or was only ' +
      'recorded. Pass agentId to see one agent; call list_agents to turn a ' +
      'name into an id. For "is it still down" use list_agent_incidents.',
    parameters: z.object({
      agentId: z
        .string()
        .optional()
        .describe('Only this agent (list_agents has the ids).'),
      since: sinceSchema,
      limit: limitSchema,
    }),
  })
  async listAgentEvents(
    args: { agentId?: string; since?: string; limit?: number },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const since = parseSince(args.since);
    if (since === null) return BAD_SINCE;
    const missing = await this.missingAgent(args.agentId);
    if (missing) return missing;

    const page = await this.service.listEvents({
      agentId: args.agentId,
      since,
      limit: args.limit ?? EVENT_PAGE_DEFAULT,
    });
    return ok({
      events: page.items.map(toToolEvent),
      more: page.nextCursor !== null,
    });
  }

  @Tool({
    name: 'list_agent_incidents',
    topic: ToolTopics.Agents,
    title: 'List agent incidents',
    template: 'Which agents went down since «when», and are any still down?',
    description:
      'Incidents, newest first. An incident is one stretch of trouble for ' +
      'one agent: it opens on the first failure and closes when Ranch has ' +
      'seen the agent running for ten quiet minutes. Each has its state ' +
      '(open or closed), the first cause, who witnessed it, how it ended ' +
      '(recovered; unconfirmed — only an outside sender ever saw it; ' +
      'stopped; deleted) and whether each notification reached the team ' +
      '(sent, pending, failed = not delivered, skipped = no destination). ' +
      'state "open" answers "what is down right now".',
    parameters: z.object({
      agentId: z
        .string()
        .optional()
        .describe('Only this agent (list_agents has the ids).'),
      state: z
        .enum(['open', 'closed'])
        .optional()
        .describe('open = still going on; closed = over.'),
      since: sinceSchema,
      limit: limitSchema,
    }),
  })
  async listAgentIncidents(
    args: {
      agentId?: string;
      state?: 'open' | 'closed';
      since?: string;
      limit?: number;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const since = parseSince(args.since);
    if (since === null) return BAD_SINCE;
    const missing = await this.missingAgent(args.agentId);
    if (missing) return missing;

    const page = await this.service.listIncidents({
      agentId: args.agentId,
      state: args.state,
      since,
      limit: args.limit ?? EVENT_PAGE_DEFAULT,
    });
    return ok({
      incidents: page.items.map(toToolIncident),
      more: page.nextCursor !== null,
    });
  }

  @Tool({
    name: 'get_notification_destination',
    topic: ToolTopics.Settings,
    title: 'Show where failure notifications go',
    template:
      'Where do agent failure notifications go, and did the last one arrive?',
    description:
      'Whether a destination for agent failure notifications is set, its ' +
      'kind (Slack), the last four characters of its address, who set it ' +
      'and when, whether messages can link to the console (consoleLinks is ' +
      'false until ADMIN_URL is set on the API), and the outcome of the last ' +
      'delivery. Never the address itself — it cannot be read back by anyone.',
  })
  async getNotificationDestination(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return ok({
      destination: toToolDestination(await this.destinations.view()),
    });
  }

  @Tool({
    name: 'set_notification_destination',
    topic: ToolTopics.Settings,
    title: 'Set the Slack address for notifications',
    template: 'Send agent failure notifications to the Slack webhook «address»',
    description:
      'Set where agent failure notifications go: a Slack incoming-webhook ' +
      'address (https://hooks.slack.com/services/…) the person created in ' +
      'Slack. It replaces the current one. The address is a secret: it is ' +
      'stored and never shown again, so do not repeat it back. Anything that ' +
      'is not a Slack incoming webhook is refused. Call ' +
      'send_test_notification afterwards to prove it works.',
    parameters: z.object({
      webhookUrl: z
        .string()
        .describe(
          'The Slack incoming-webhook address, exactly as Slack gave it.',
        ),
    }),
  })
  async setNotificationDestination(
    args: { webhookUrl: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    try {
      const view = await this.destinations.save(
        args.webhookUrl,
        httpRequest.user?.sub ?? 'unknown',
      );
      this.logger.log('Notification destination set through MCP');
      return ok({
        destination: toToolDestination(view),
        note: 'Saved. Call send_test_notification to check that a message arrives.',
      });
    } catch (e) {
      return this.refusal(e);
    }
  }

  @Tool({
    name: 'send_test_notification',
    topic: ToolTopics.Settings,
    title: 'Send a test notification',
    template: 'Send a test notification to the team chat',
    description:
      'Send one message, clearly labelled as a test, to the notification ' +
      'destination and report whether it arrived (delivered) or what the ' +
      'destination answered (error). With no destination set it says so — ' +
      'call set_notification_destination first.',
  })
  async sendTestNotification(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    try {
      const result = await this.destinations.sendTest();
      return ok({ delivered: result.delivered, error: result.error });
    } catch (e) {
      return this.refusal(
        e,
        ' — call set_notification_destination with a Slack webhook address first',
      );
    }
  }

  @Tool({
    name: 'remove_notification_destination',
    topic: ToolTopics.Settings,
    title: 'Stop sending notifications',
    template: 'Stop sending agent failure notifications to Slack',
    destructive: true,
    description:
      'Remove the notification destination. From then on nobody outside the ' +
      'console is told when an agent goes down; events keep being recorded, ' +
      'and messages still waiting to be sent are dropped. The address cannot ' +
      'be recovered — the person would paste it in again. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async removeNotificationDestination(
    args: { confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const view = await this.destinations.view();
    if (!view.configured) {
      return ok({
        error: 'No notification destination is set — nothing to remove',
      });
    }
    const refusal = confirmed(
      args,
      `stop sending agent failure notifications to Slack (…${view.hint}) — nobody outside the console will be told when an agent goes down`,
    );
    if (refusal) return refusal;
    await this.destinations.remove();
    this.logger.log('Notification destination removed through MCP');
    return ok({ removed: true });
  }

  private async missingAgent(agentId?: string): Promise<ToolResult | null> {
    if (!agentId) return null;
    if (await this.agents.findById(agentId)) return null;
    return ok({
      error: `Agent ${agentId} not found — call list_agents to find the id`,
    });
  }

  /** A service's own refusal (400, 409) as a result the model can act on. */
  private refusal(e: unknown, next = ''): ToolResult {
    if (e instanceof HttpException && e.getStatus() < 500) {
      return ok({ error: `${e.message}${next}` });
    }
    throw e;
  }
}
