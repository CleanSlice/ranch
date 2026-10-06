import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { IAgentGateway } from '#/agent/agent/domain';
import { UserRoleTypes } from '#/user/user/domain';
import { AgentEventTool } from './agentEvent.tool';
import type {
  AgentEventService,
  NotificationDestinationService,
} from './domain';

/**
 * These tools are the Events page and the Notifications settings from the
 * chat. What matters more than any happy path: a plain agent can neither see
 * nor call them, nothing they return carries the destination's address, and
 * removing the destination touches nothing until the person said yes.
 */
const ADDRESS = 'https://hooks.slack.com/services/T000/B000/SECRETSECRET';

const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:rancher', email: '', roles } }) as unknown as Request;
const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

type Result = { content: { text: string }[] };
const textOf = (r: unknown) =>
  (r as Result).content.map((c) => c.text).join('\n');
const jsonOf = (r: unknown) => JSON.parse(textOf(r));

const at = new Date('2026-10-06T21:14:03.000Z');

const event = (over: Record<string, unknown> = {}) => ({
  id: 'evt-1',
  agentId: 'a1',
  agentRef: 'a1',
  agentName: 'Support Bot',
  status: 'failed',
  reason: 'OOMKilled',
  witness: 'external',
  apiKeyId: 'key-1',
  senderName: 'cluster-watcher',
  tool: 'kubernetes-event-exporter',
  ranchStatus: 'running',
  outcome: 'opened',
  incidentId: 'inc-1',
  occurredAt: at,
  receivedAt: at,
  // what a careless service might add
  webhookUrl: ADDRESS,
  ...over,
});

const incident = () => ({
  id: 'inc-1',
  agentId: 'a1',
  agentName: 'Support Bot',
  open: true,
  status: 'failed',
  reason: 'OOMKilled',
  ranchWitnessed: false,
  openedAt: at,
  lastFailureAt: at,
  upSince: null,
  closedAt: null,
  resolution: null,
  witnesses: ['cluster-watcher'],
  eventCount: 2,
  notifications: [
    {
      kind: 'opened',
      status: 'failed',
      attempts: 7,
      sentAt: null,
      lastError: 'Slack answered 503',
    },
  ],
  webhookUrl: ADDRESS,
});

const view = (configured = true) => ({
  configured,
  kind: configured ? 'slack' : null,
  hint: configured ? 'CRET' : null,
  updatedBy: configured ? 'user-1' : null,
  updatedAt: configured ? at : null,
  consoleLinks: true,
  lastDelivery: configured ? { at, ok: true, error: null } : null,
  webhookUrl: configured ? ADDRESS : undefined,
});

function harness(configured = true) {
  const service = {
    listEvents: jest.fn(async () => ({ items: [event()], nextCursor: null })),
    listIncidents: jest.fn(async () => ({
      items: [incident()],
      nextCursor: 'more',
    })),
  };
  const destinations = {
    view: jest.fn(async () => view(configured)),
    save: jest.fn(async () => view(true)),
    remove: jest.fn(async () => undefined),
    sendTest: jest.fn(async () => ({ delivered: true, error: null })),
  };
  const agents = {
    findById: jest.fn(async (id: string) =>
      id === 'a1' ? { id, name: 'Support Bot' } : null,
    ),
  };
  const tool = new AgentEventTool(
    service as unknown as AgentEventService,
    destinations as unknown as NotificationDestinationService,
    agents as unknown as IAgentGateway,
  );
  return { tool, service, destinations, agents };
}

describe('AgentEventTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    expect(await harness().tool.isListedForRequest(plainAgent())).toBe(false);
  });

  it('lists them for an operator agent', async () => {
    expect(await harness().tool.isListedForRequest(operator())).toBe(true);
  });

  it('refuses a plain agent that calls one by name, and touches nothing', async () => {
    const { tool, service, destinations } = harness();
    const calls = [
      () => tool.listAgentEvents({}, null, plainAgent()),
      () => tool.listAgentIncidents({}, null, plainAgent()),
      () => tool.getNotificationDestination({}, null, plainAgent()),
      () =>
        tool.setNotificationDestination(
          { webhookUrl: ADDRESS },
          null,
          plainAgent(),
        ),
      () => tool.sendTestNotification({}, null, plainAgent()),
      () =>
        tool.removeNotificationDestination(
          { confirm: true },
          null,
          plainAgent(),
        ),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(service.listEvents).not.toHaveBeenCalled();
    expect(destinations.save).not.toHaveBeenCalled();
    expect(destinations.remove).not.toHaveBeenCalled();
    expect(destinations.sendTest).not.toHaveBeenCalled();
  });

  it('keeps the destination for the owner, as the console does: an admin is refused', async () => {
    // The controller guards these three routes with @Roles(Owner). A caller
    // one step below must not get through the chat what the console refuses.
    const { tool, destinations } = harness();
    const admin = () => request([UserRoleTypes.Admin]);

    await expect(
      tool.setNotificationDestination({ webhookUrl: ADDRESS }, null, admin()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.sendTestNotification({}, null, admin()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.removeNotificationDestination({ confirm: true }, null, admin()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(await tool.isListedForRequest(admin())).toBe(false);
    expect(destinations.save).not.toHaveBeenCalled();
    expect(destinations.sendTest).not.toHaveBeenCalled();
    expect(destinations.remove).not.toHaveBeenCalled();
  });
});

describe('AgentEventTool — reading', () => {
  it('lists events with who witnessed them and what they did', async () => {
    const { tool, service } = harness();

    const result = await tool.listAgentEvents(
      { agentId: 'a1', since: '2026-10-06T00:00:00Z', limit: 10 },
      null,
      operator(),
    );

    expect(service.listEvents).toHaveBeenCalledWith({
      agentId: 'a1',
      since: new Date('2026-10-06T00:00:00Z'),
      limit: 10,
    });
    expect(jsonOf(result)).toEqual({
      events: [
        {
          id: 'evt-1',
          agentId: 'a1',
          agentRef: 'a1',
          agentName: 'Support Bot',
          status: 'failed',
          reason: 'OOMKilled',
          witness: 'external',
          senderName: 'cluster-watcher',
          tool: 'kubernetes-event-exporter',
          ranchStatus: 'running',
          outcome: 'opened',
          incidentId: 'inc-1',
          occurredAt: at.toISOString(),
          receivedAt: at.toISOString(),
        },
      ],
      more: false,
    });
  });

  it('lists incidents with their state and whether the team was told', async () => {
    const { tool, service } = harness();

    const result = jsonOf(
      await tool.listAgentIncidents({ state: 'open' }, null, operator()),
    );

    expect(service.listIncidents).toHaveBeenCalledWith({
      agentId: undefined,
      state: 'open',
      since: undefined,
      limit: 50,
    });
    expect(result.more).toBe(true);
    expect(result.incidents[0]).toMatchObject({
      state: 'open',
      witnesses: ['cluster-watcher'],
      eventCount: 2,
      notifications: [
        {
          kind: 'opened',
          status: 'failed',
          attempts: 7,
          lastError: 'Slack answered 503',
        },
      ],
    });
  });

  it('says where to look when the agent id is not one it knows', async () => {
    const { tool, service } = harness();

    const text = textOf(
      await tool.listAgentEvents({ agentId: 'nope' }, null, operator()),
    );

    expect(text).toContain('not found');
    expect(text).toContain('list_agents');
    expect(service.listEvents).not.toHaveBeenCalled();
  });

  it('refuses a date it cannot read instead of ignoring it', async () => {
    const { tool, service } = harness();

    const text = textOf(
      await tool.listAgentIncidents({ since: 'last night' }, null, operator()),
    );

    expect(text).toContain('ISO 8601');
    expect(service.listIncidents).not.toHaveBeenCalled();
  });

  it('shows the destination without its address', async () => {
    const { tool } = harness();

    const result = jsonOf(
      await tool.getNotificationDestination({}, null, operator()),
    );

    expect(result.destination).toEqual({
      configured: true,
      kind: 'slack',
      hint: 'CRET',
      updatedBy: 'user-1',
      updatedAt: at.toISOString(),
      consoleLinks: true,
      lastDelivery: { at: at.toISOString(), ok: true, error: null },
    });
  });
});

describe('AgentEventTool — the destination', () => {
  it('saves the address as the calling agent and does not repeat it', async () => {
    const { tool, destinations } = harness();

    const text = textOf(
      await tool.setNotificationDestination(
        { webhookUrl: ADDRESS },
        null,
        operator(),
      ),
    );

    expect(destinations.save).toHaveBeenCalledWith(ADDRESS, 'agent:rancher');
    expect(text).not.toContain('SECRETSECRET');
    expect(text).toContain('send_test_notification');
  });

  it('passes on why an address was refused', async () => {
    const { tool, destinations } = harness();
    destinations.save.mockRejectedValueOnce(
      new BadRequestException(
        'The address must be a Slack incoming webhook: https://hooks.slack.com/services/…',
      ),
    );

    const text = textOf(
      await tool.setNotificationDestination(
        { webhookUrl: 'https://example.com/x' },
        null,
        operator(),
      ),
    );

    expect(text).toContain('must be a Slack incoming webhook');
  });

  it('sends a test and reports the outcome', async () => {
    const { tool } = harness();

    expect(
      jsonOf(await tool.sendTestNotification({}, null, operator())),
    ).toEqual({
      delivered: true,
      error: null,
    });
  });

  it('names the next step when there is nowhere to send a test', async () => {
    const { tool, destinations } = harness();
    destinations.sendTest.mockRejectedValueOnce(
      new ConflictException('No notification destination is set'),
    );

    const text = textOf(await tool.sendTestNotification({}, null, operator()));

    expect(text).toContain('No notification destination is set');
    expect(text).toContain('set_notification_destination');
  });

  it('refuses to remove without confirm, says what would happen, and touches nothing', async () => {
    const { tool, destinations } = harness();

    const text = textOf(
      await tool.removeNotificationDestination({}, null, operator()),
    );

    expect(text).toContain('stop sending agent failure notifications');
    expect(destinations.remove).not.toHaveBeenCalled();
  });

  it('removes once confirmed', async () => {
    const { tool, destinations } = harness();

    const result = jsonOf(
      await tool.removeNotificationDestination(
        { confirm: true },
        null,
        operator(),
      ),
    );

    expect(destinations.remove).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ removed: true });
  });

  it('reports that nothing is set before asking for a confirmation', async () => {
    const { tool, destinations } = harness(false);

    const text = textOf(
      await tool.removeNotificationDestination({}, null, operator()),
    );

    expect(text).toContain('nothing to remove');
    expect(destinations.remove).not.toHaveBeenCalled();
  });
});

describe('AgentEventTool — no result carries the address', () => {
  it('whatever the services hand back', async () => {
    const { tool } = harness();
    const results = [
      await tool.listAgentEvents({}, null, operator()),
      await tool.listAgentIncidents({}, null, operator()),
      await tool.getNotificationDestination({}, null, operator()),
      await tool.setNotificationDestination(
        { webhookUrl: ADDRESS },
        null,
        operator(),
      ),
      await tool.sendTestNotification({}, null, operator()),
      await tool.removeNotificationDestination({}, null, operator()),
      await tool.removeNotificationDestination(
        { confirm: true },
        null,
        operator(),
      ),
    ];

    for (const result of results) {
      expect(textOf(result)).not.toContain('SECRETSECRET');
      expect(textOf(result)).not.toContain('webhookUrl');
    }
  });
});
