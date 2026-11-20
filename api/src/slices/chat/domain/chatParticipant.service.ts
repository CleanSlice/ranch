import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { IPeerGateway } from '#/agent/peer/domain/peer.gateway';
import { connectionIdOfPeerClient } from '#/agent/peer/domain/peer.types';
import { OWNER_CLIENT_ID } from '#/bridle/domain/chatIdentity';
import { UserRoleTypes } from '#/user/user/domain';
import { IUserGateway } from '#/user/user/domain/user.gateway';

/** A signed-in person a conversation belongs to. */
export interface IChatPerson {
  /** Null once the account no longer exists. */
  name: string | null;
  role: string | null;
}

/** Another agent a conversation was handed over by. */
export interface IChatPeer {
  /** The asking agent's name, for a viewer who reaches it; null otherwise. */
  name: string | null;
}

export interface IChatParticipant {
  person: IChatPerson | null;
  peer: IChatPeer | null;
}

/** What `participantOf` needs to know about a conversation. */
export interface IChatParticipantSource {
  channel: string;
  externalUserId: string;
}

const NOBODY: IChatParticipant = { person: null, peer: null };

/**
 * Who a conversation in an agent's list is with, in words a person can read
 * (CLEAN-236).
 *
 * The list used to say "Admin" for the one conversation every Owner and
 * Admin shared, and nothing but an id for everybody else. An Admin's
 * conversation is under their own id now, so the list would have turned
 * into a column of ids; and a conversation another agent handed over was
 * named by that agent's id, shown to somebody who may not reach it.
 *
 *  - `admin` is the Owner, and an account's id is that account: both by
 *    name.
 *  - `peer:<connection>:<context>` is another agent's question. The agent is
 *    named only for a viewer who reaches it; otherwise it is a colleague,
 *    and nothing more. A conversation stored before the id became the
 *    connection's names no agent at all.
 *
 * One instance serves one request: the lookups are remembered, so a page of
 * fifty conversations of one person costs one read.
 */
@Injectable()
export class ChatParticipantService {
  constructor(
    private readonly users: IUserGateway,
    private readonly agents: IAgentGateway,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * A resolver for one request. `reaches` is the viewer's own reach: whether
   * an agent's name is theirs to be told.
   */
  forViewer(reaches: (agentId: string) => boolean) {
    const people = new Map<string, Promise<IChatPerson | null>>();
    const peers = new Map<string, Promise<IChatPeer>>();
    let owner: Promise<IChatPerson | null> | undefined;

    const ownerOnce = () =>
      (owner ??= this.users.findAll().then((all) => {
        const found = all.find((u) => u.role === UserRoleTypes.Owner);
        return found ? { name: found.name, role: found.role } : null;
      }));

    const personOnce = (id: string) => {
      let known = people.get(id);
      if (!known) {
        known = this.users
          .findById(id)
          .then((user) => (user ? { name: user.name, role: user.role } : null));
        people.set(id, known);
      }
      return known;
    };

    const peerOnce = (connectionId: string) => {
      let known = peers.get(connectionId);
      if (!known) {
        known = this.askingAgentOf(connectionId).then((agent) => ({
          name: agent && reaches(agent.id) ? agent.name : null,
        }));
        peers.set(connectionId, known);
      }
      return known;
    };

    return async (
      session: IChatParticipantSource,
    ): Promise<IChatParticipant> => {
      // Only the hub's own conversations are named by an identity this
      // service can read: a Telegram chat id is somebody else's number.
      if (session.channel !== 'bridle') return NOBODY;

      const connectionId = connectionIdOfPeerClient(session.externalUserId);
      if (connectionId) {
        return { person: null, peer: await peerOnce(connectionId) };
      }
      if (session.externalUserId === OWNER_CLIENT_ID) {
        return { person: await ownerOnce(), peer: null };
      }
      return { person: await personOnce(session.externalUserId), peer: null };
    };
  }

  /**
   * The agent that holds a connection. Looked up by token at call time: the
   * peer slice imports the hub, which imports this one, and a conversation
   * list must not be what closes that circle.
   */
  private async askingAgentOf(
    connectionId: string,
  ): Promise<{ id: string; name: string } | null> {
    let peers: IPeerGateway | undefined;
    try {
      peers = this.moduleRef.get(IPeerGateway, { strict: false });
    } catch {
      peers = undefined;
    }
    const connection = await peers?.findById(connectionId);
    if (!connection) return null;
    const agent = await this.agents.findById(connection.agentId);
    return agent ? { id: agent.id, name: agent.name } : null;
  }
}
