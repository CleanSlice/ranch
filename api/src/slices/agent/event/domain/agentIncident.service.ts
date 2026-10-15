import { Injectable, Logger } from '@nestjs/common';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  AgentEventWitnessTypes,
  IAgentIncidentData,
  IClosedNotificationPayload,
  IncidentResolutionTypes,
  IOpenedNotificationPayload,
  JOINED_REPLY_GAP_MS,
  QUIET_MS,
} from './agentEvent.types';
import { NotificationDestinationService } from './notificationDestination.service';

export interface IAttachFailureInput {
  agentId: string;
  agentName: string;
  status: 'failed' | 'unreachable';
  reason: string | null;
  witness: AgentEventWitnessTypes;
  senderName: string;
  tool: string | null;
  ranchStatus: string | null;
  occurredAt: Date;
  receivedAt: Date;
}

export interface IAttachFailureResult {
  incidentId: string;
  outcome: 'opened' | 'joined';
}

// Each round can lose one race: an open to another opener, a join to the
// sweep closing the incident. Losing both in a row three times over is not a
// race any more.
const ATTACH_ROUNDS = 3;

/**
 * One stretch of trouble for one agent: opened by the first failure, joined
 * by every later one, closed when Ranch has seen the agent running for ten
 * quiet minutes. On the webhook transport the team is told when it opens
 * and when it closes — never in between. On the bot transport (CLEAN-165)
 * every step is a reply in the incident's thread, and the incident keeps
 * which transport it started on so it finishes there.
 */
@Injectable()
export class AgentIncidentService {
  private readonly logger = new Logger(AgentIncidentService.name);

  constructor(
    private readonly gateway: IAgentEventGateway,
    private readonly destinations: NotificationDestinationService,
  ) {}

  /**
   * Puts a failure into the agent's open incident, opening one if there is
   * none. Which of the two happened is the database's answer, not a guess:
   * two failures arriving together — from two senders, or on two replicas —
   * both try to open, and the unique `openKey` lets exactly one.
   */
  async attachFailure(
    input: IAttachFailureInput,
  ): Promise<IAttachFailureResult> {
    for (let round = 0; round < ATTACH_ROUNDS; round += 1) {
      const open = await this.gateway.findOpenIncident(input.agentId);
      if (open) {
        // Only the bot has a thread to put a later report in.
        const reply =
          open.transport === 'bot'
            ? {
                kind: 'joined' as const,
                agentId: input.agentId,
                agentName: open.agentName,
                status: input.status,
                reason: input.reason,
                occurredAt: input.occurredAt.toISOString(),
                witness: input.witness,
                senderName: input.senderName,
                tool: input.tool,
                ranchStatus: input.ranchStatus,
              }
            : null;
        const joined = await this.gateway.touchIncidentFailure(
          open.id,
          input.receivedAt,
          input.witness === 'ranch',
          input.senderName,
          reply,
          JOINED_REPLY_GAP_MS,
        );
        if (joined !== 'closed')
          return { incidentId: open.id, outcome: 'joined' };
        // Closed between the read and the write — open a new one.
        continue;
      }

      const payload: IOpenedNotificationPayload = {
        kind: 'opened',
        agentId: input.agentId,
        agentName: input.agentName,
        status: input.status,
        reason: input.reason,
        occurredAt: input.occurredAt.toISOString(),
        witness: input.witness,
        senderName: input.senderName,
        tool: input.tool,
        ranchStatus: input.ranchStatus,
      };
      const opened = await this.gateway.openIncident(
        {
          agentId: input.agentId,
          agentName: input.agentName,
          status: input.status,
          reason: input.reason,
          ranchWitnessed: input.witness === 'ranch',
          // A sender's clock may run ahead; an incident cannot have started
          // after we heard of it.
          openedAt:
            input.occurredAt < input.receivedAt
              ? input.occurredAt
              : input.receivedAt,
          lastFailureAt: input.receivedAt,
          // Decided once, here: the incident finishes on this transport
          // whatever the owner switches to later.
          transport: await this.destinations.kind(),
        },
        payload,
      );
      if (opened) return { incidentId: opened.id, outcome: 'opened' };
      // Someone else opened it first — join theirs on the next round.
    }
    throw new Error(
      `could not attach a failure to an incident for agent ${input.agentId}`,
    );
  }

  /** Ranch saw the agent turn 'running': the quiet period starts here. */
  async noteRunning(agentId: string, at: Date): Promise<void> {
    const open = await this.gateway.findOpenIncident(agentId);
    if (!open) return;
    await this.gateway.setIncidentUpSince(
      agentId,
      at,
      open.transport === 'bot'
        ? {
            kind: 'running',
            agentId,
            agentName: open.agentName,
            at: at.toISOString(),
          }
        : null,
    );
  }

  /**
   * Closes what can be closed. Returns how many closing messages were queued.
   *
   * | Agent as Ranch holds it            | Outcome                               |
   * |------------------------------------|---------------------------------------|
   * | running, quiet for QUIET_MS        | closed, told — recovered/unconfirmed  |
   * | stopped                            | closed, silent — a person did it      |
   * | gone                               | closed, silent                        |
   * | anything else                      | stays open                            |
   *
   * "Silent" on the bot transport still means a reply in the thread and the
   * root rewritten — nobody is paged, the channel gets no new message.
   *
   * "Quiet" counts from the later of the last failure and the moment the
   * agent came up, so a container that is Ready for a few seconds of every
   * crash loop never reads as a recovery.
   */
  async sweep(now: Date): Promise<number> {
    const open = await this.gateway.listOpenIncidentsWithAgent();
    let queued = 0;
    for (const { incident, agentStatus, firstSenderName } of open) {
      try {
        if (agentStatus === null) {
          if (await this.close(incident, 'deleted', now, firstSenderName)) {
            queued += 1;
          }
          continue;
        }
        if (agentStatus === 'stopped') {
          if (await this.close(incident, 'stopped', now, firstSenderName)) {
            queued += 1;
          }
          continue;
        }
        if (agentStatus !== 'running') continue;

        const upAt =
          incident.upSince && incident.upSince > incident.lastFailureAt
            ? incident.upSince
            : incident.lastFailureAt;
        if (now.getTime() - upAt.getTime() < QUIET_MS) continue;

        // Nobody but an outside sender ever saw this agent down: say so,
        // rather than claim a recovery Ranch cannot vouch for.
        const resolution = incident.ranchWitnessed
          ? 'recovered'
          : 'unconfirmed';
        const closed = await this.gateway.closeIncident(
          incident.id,
          resolution,
          now,
          this.closedPayload(incident, resolution, upAt, now, firstSenderName),
        );
        if (closed) queued += 1;
      } catch (err) {
        // One incident that cannot be judged must not hold up the rest.
        this.logger.warn(
          `Sweep failed for incident ${incident.id}: ${(err as Error).message}`,
        );
      }
    }
    return queued;
  }

  /** A person's doing or a deletion: silent on the webhook, a reply on the bot. */
  private async close(
    incident: IAgentIncidentData,
    resolution: 'stopped' | 'deleted',
    at: Date,
    firstSenderName: string | null,
  ): Promise<boolean> {
    const payload =
      incident.transport === 'bot'
        ? this.closedPayload(incident, resolution, at, at, firstSenderName)
        : null;
    const closed = await this.gateway.closeIncident(
      incident.id,
      resolution,
      at,
      payload,
    );
    return closed && payload !== null;
  }

  private closedPayload(
    incident: IAgentIncidentData,
    resolution: IncidentResolutionTypes,
    upAt: Date,
    closedAt: Date,
    firstSenderName: string | null,
  ): IClosedNotificationPayload {
    return {
      kind: 'closed',
      agentId: incident.agentId,
      agentName: incident.agentName,
      resolution,
      openedAt: incident.openedAt.toISOString(),
      upAt: upAt.toISOString(),
      closedAt: closedAt.toISOString(),
      firstSenderName,
      eventCount: incident.eventCount,
    };
  }
}
