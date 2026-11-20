import { Injectable } from '@nestjs/common';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { IUserGateway } from '#/user/user/domain/user.gateway';
import { UserRoleTypes } from '#/user/user/domain';
import { PeerOrigins, type IAgentPeerData } from './peer.types';

/**
 * What a peer connection is to somebody (CLEAN-236).
 *
 * A connection A→B used to be a setting of A: whoever managed A read B's
 * name, card and answers and could cut the connection, whatever their access
 * to B, and whoever talked to A was served by B. Nine places listed, used or
 * changed a connection and one of them (`peerLink.controller.ts`) asked about
 * B. The rule now lives here, once, and all of them ask it:
 *
 *   a connection to an agent of this Ranch exists for a person only when
 *   that person reaches the agent.
 *
 * The one way it serves anybody else is the visitors mark, set by somebody
 * who manages both agents; the peer is then shown without its name. An
 * external peer is no agent of ours, so there is nobody to reach: it serves
 * everybody when somebody who manages A added it, and one person when
 * anybody else did.
 *
 * `specs/033-identity-boundaries/contracts/colleagues.md` §1 is this table,
 * and `peerAccess.spec.ts` pins it row by row.
 */

export const PeerVisibilities = {
  /** Shown as it is. */
  Full: 'full',
  /** Shown as an unnamed colleague: it serves this viewer, who does not reach it. */
  Masked: 'masked',
  /** Does not exist for this viewer. Answer as for an unknown connection. */
  Hidden: 'hidden',
} as const;

export type PeerVisibility =
  (typeof PeerVisibilities)[keyof typeof PeerVisibilities];

/** The columns the rule reads. */
export type IPeerAccessRow = Pick<
  IAgentPeerData,
  'origin' | 'peerAgentId' | 'openToVisitors' | 'ownerUserId'
>;

/**
 * Who is looking at, or being served by, the connections of one agent.
 * Gathered once per request by `PeerAccessService.viewerOf`.
 */
export interface IPeerViewer {
  /**
   * The account, or null for nobody: a guest, an agent acting for itself, a
   * colleague's question whose chain no person started.
   */
  userId: string | null;
  /** Whether that account reaches an agent. Never true for nobody. */
  reaches(agentId: string): boolean;
  /** Whether the viewer manages the agent that holds the connections. */
  managesAgent: boolean;
}

/** Nobody: reaches nothing, manages nothing. */
export const NOBODY: IPeerViewer = {
  userId: null,
  reaches: () => false,
  managesAgent: false,
};

function reachesPeer(row: IPeerAccessRow, viewer: IPeerViewer): boolean {
  return (
    viewer.userId !== null &&
    typeof row.peerAgentId === 'string' &&
    viewer.reaches(row.peerAgentId)
  );
}

/** Whether a question from this caller may be handed to the peer. */
export function peerServes(row: IPeerAccessRow, viewer: IPeerViewer): boolean {
  if (row.origin === PeerOrigins.External) {
    return row.ownerUserId === null || row.ownerUserId === viewer.userId;
  }
  return reachesPeer(row, viewer) || row.openToVisitors;
}

/** How the connection is shown to this viewer, if at all. */
export function peerVisibility(
  row: IPeerAccessRow,
  viewer: IPeerViewer,
): PeerVisibility {
  if (row.origin === PeerOrigins.External) {
    // An address outside the Ranch hides no agent of ours. What is personal
    // about it is whose questions go there, and whoever manages A must be
    // able to see, and remove, what is attached to their agent.
    const shown =
      row.ownerUserId === null ||
      row.ownerUserId === viewer.userId ||
      viewer.managesAgent;
    return shown ? PeerVisibilities.Full : PeerVisibilities.Hidden;
  }
  if (reachesPeer(row, viewer)) return PeerVisibilities.Full;
  return row.openToVisitors ? PeerVisibilities.Masked : PeerVisibilities.Hidden;
}

/**
 * Turns the party of a call into the viewer the rule reads.
 *
 * Reach is read from the database here, at the time of the call, so a change
 * to somebody's access is in force on their next message and no connection
 * has to change for it (FR-002).
 */
@Injectable()
export class PeerAccessService {
  constructor(
    private readonly access: AgentAccessService,
    private readonly permission: AgentPermissionService,
    private readonly users: IUserGateway,
  ) {}

  /**
   * The viewer `party` is for the connections `agentId` holds.
   *
   * A person is that person. A colleague's question is the person its chain
   * was started for, as that account stands now (role, lists, still active),
   * and manages nothing. Everybody else is nobody, a trusted party included:
   * a turn the agent started for itself has no person whose reach could be
   * asked, so it is served like a visitor (FR-017).
   */
  async viewerOf(party: ICallerParty, agentId: string): Promise<IPeerViewer> {
    if (party.kind === 'person') {
      const [reach, managed] = await Promise.all([
        this.access.reachableIds(party),
        this.permission.manageable(party, agentId),
      ]);
      return {
        userId: party.userId,
        reaches: (id) => reach.has(id),
        managesAgent: managed !== null,
      };
    }

    if (party.kind === 'peer' && party.forUserId) {
      const user = await this.users.findById(party.forUserId);
      if (
        !user ||
        user.status !== 'active' ||
        user.role === UserRoleTypes.Agent
      ) {
        return NOBODY;
      }
      const reach = await this.access.reachableIds({
        kind: 'person',
        userId: user.id,
        role: user.role,
      });
      return {
        userId: user.id,
        reaches: (id) => reach.has(id),
        managesAgent: false,
      };
    }

    return NOBODY;
  }
}
