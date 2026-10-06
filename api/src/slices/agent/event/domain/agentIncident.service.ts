import { Injectable, Logger } from '@nestjs/common';
import { IAgentEventGateway } from './agentEvent.gateway';
import {
  AgentEventWitnessTypes,
  IncidentResolutionTypes,
  IOpenedNotificationPayload,
  QUIET_MS,
} from './agentEvent.types';

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
 * quiet minutes. The team is told when it opens and when it closes — never in
 * between.
 */
@Injectable()
export class AgentIncidentService {
  private readonly logger = new Logger(AgentIncidentService.name);

  constructor(private readonly gateway: IAgentEventGateway) {}

  /**
   * Puts a failure into the agent's open incident, opening one if there is
   * none. Which of the two happened is the database's answer, not a guess:
   * two failures arriving together — from two senders, or on two replicas —
   * both try to open, and the unique `openKey` lets exactly one.
   */
  async attachFailure(input: IAttachFailureInput): Promise<IAttachFailureResult> {
    for (let round = 0; round < ATTACH_ROUNDS; round += 1) {
      const open = await this.gateway.findOpenIncident(input.agentId);
      if (open) {
        const joined = await this.gateway.touchIncidentFailure(
          open.id,
          input.receivedAt,
          input.witness === 'ranch',
        );
        if (joined) return { incidentId: open.id, outcome: 'joined' };
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
    await this.gateway.setIncidentUpSince(agentId, at);
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
          await this.close(incident.id, 'deleted', now);
          continue;
        }
        if (agentStatus === 'stopped') {
          await this.close(incident.id, 'stopped', now);
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
        const resolution = incident.ranchWitnessed ? 'recovered' : 'unconfirmed';
        const closed = await this.gateway.closeIncident(
          incident.id,
          resolution,
          now,
          {
            kind: 'closed',
            agentId: incident.agentId,
            agentName: incident.agentName,
            resolution,
            openedAt: incident.openedAt.toISOString(),
            upAt: upAt.toISOString(),
            firstSenderName,
          },
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

  private async close(
    id: string,
    resolution: IncidentResolutionTypes,
    at: Date,
  ): Promise<void> {
    await this.gateway.closeIncident(id, resolution, at, null);
  }
}
