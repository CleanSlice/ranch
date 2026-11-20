import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { IBridleGateway } from '#/bridle/domain/bridle.gateway';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { IPeerGateway } from './peer.gateway';
import { PeerAccessService } from './peerAccess';
import { matchRoster, rosterFor } from './peerRoster';
import { IDelegationGateway } from './delegation.gateway';
import {
  A2aClient,
  assertPublicPeerAddress,
  assertResolvesPublic,
} from './a2a.client';
import { buildDelegationStep, causeText } from './delegationStep';
import {
  A2aRoles,
  A2aTaskStates,
  renderReplyParts,
  replyTextOfTask,
  type A2aSendMessageResult,
  type IA2aTask,
} from './a2a.types';
import { selectCallableInterface } from './a2a.legacy';
import {
  DELEGATION_EXCERPT_CHARS,
  DelegationError,
  DelegationErrorCodes,
  DelegationStatuses,
  EMPTY_REPLY_NOTE,
  PeerOrigins,
  type DelegationErrorCode,
  type DelegationStatus,
  type IAgentPeerData,
  type IMatchedSkill,
} from './peer.types';

export interface IRunDelegationInput {
  callerAgentId: string;
  /**
   * Who the turn is for (CLEAN-236). The peer is resolved among the
   * connections that serve this party, and among no others.
   */
  party: ICallerParty;
  /** Peer id, or the peer's name as the card spells it. */
  peer: string;
  task: string;
  reason: string;
  contextId?: string;
  /** The chain this request is already part of, when the caller is itself a peer. */
  inboundChain: string[];
}

export type IDelegationOutcome =
  | { kind: 'no_match'; peers: string[] }
  | {
      kind: 'done';
      status: DelegationStatus;
      /** How the peer is named to this caller: its name, or "a colleague". */
      peerName: string;
      /** The caller is served by the peer without reaching it. */
      masked: boolean;
      contextId: string;
      durationMs: number;
      text?: string;
      errorCode?: DelegationErrorCode;
      cause?: string;
    };

/** Words shorter than this carry no signal when matching a reason to a skill. */
const MEANINGFUL_WORD_CHARS = 4;
const MAX_MATCHED_SKILLS = 3;

/**
 * One delegation, end to end (CLEAN-74): pick the peer, write the audit row,
 * show the person what is happening, ask, and record how it went.
 *
 * The ordering is deliberate and worth keeping: the row exists before the
 * outbound call, so a crash mid-flight still leaves evidence; the step is
 * pushed before the wait, so the chat never looks idle; and the row is
 * finished exactly once, whatever happened.
 */
@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly peers: IPeerGateway,
    private readonly delegations: IDelegationGateway,
    private readonly client: A2aClient,
    private readonly hub: IBridleGateway,
    private readonly access: PeerAccessService,
  ) {}

  async run(
    input: IRunDelegationInput,
    timeoutMs: number,
  ): Promise<IDelegationOutcome> {
    // Asked now, not when the roster was described: access taken away a
    // minute ago is gone for this call, whatever the model still remembers.
    const [connections, viewer] = await Promise.all([
      this.peers.listByAgent(input.callerAgentId),
      this.access.viewerOf(input.party, input.callerAgentId),
    ]);
    const roster = rosterFor(connections, viewer);
    const entry = matchRoster(roster, input.peer);
    if (!entry) {
      return { kind: 'no_match', peers: roster.map((e) => e.label) };
    }
    const { row: peer, masked } = entry;

    // The audit row keeps the peer's real name. What the caller is told is
    // `shownName`.
    const peerName =
      peer.cardSnapshot?.name ?? peer.peerAgentId ?? peer.cardUrl;
    const shownName = masked ? 'a colleague' : peerName;
    const contextId = input.contextId ?? `ctx-${crypto.randomUUID()}`;
    const matchedSkills = matchSkills(peer, `${input.reason} ${input.task}`);

    // Whoever is watching this agent right now. Unknown is a normal outcome —
    // a chat surface that renders no thinking timeline has no turn to join —
    // and the delegation must run exactly the same either way.
    const turn = this.hub.findActiveTurn(input.callerAgentId);

    const row = await this.delegations.create({
      agentId: input.callerAgentId,
      peerId: peer.id,
      peerAgentId: peer.peerAgentId,
      peerName,
      contextId,
      turnId: turn?.turnId ?? null,
      clientId: turn?.clientId ?? null,
      task: input.task,
      reason: input.reason,
      matchedSkills,
    });

    this.publish(input.callerAgentId, turn, row, masked);

    const startedAt = Date.now();
    let status: DelegationStatus = DelegationStatuses.Failed;
    let errorCode: DelegationErrorCode | undefined;
    let text: string | undefined;
    let excerpt: string | null = null;

    try {
      // The interface import approved, not whichever the card lists first —
      // an agent may prefer HTTP+JSON and still speak JSON-RPC (CLEAN-97).
      // The same call decides which dialect to speak to it (CLEAN-114).
      const callable = selectCallableInterface(peer.cardSnapshot);
      if (!callable) {
        throw new DelegationError(
          DelegationErrorCodes.Unsupported,
          'its card offers no JSON-RPC interface Ranch can call',
        );
      }
      const interfaceUrl = callable.iface.url;
      if (peer.origin === PeerOrigins.External) {
        // The interface URL inside a foreign card is remote content — never
        // let it point the platform at a private address (SSRF, CLEAN-95).
        // Import vets it too; rows saved before that check land here.
        try {
          assertPublicPeerAddress(interfaceUrl);
          await assertResolvesPublic(interfaceUrl);
        } catch (err) {
          throw new DelegationError(
            DelegationErrorCodes.AddressRefused,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      const reply = await this.client.sendMessage(
        interfaceUrl,
        peer.origin === PeerOrigins.External
          ? (peer.outboundToken ?? undefined)
          : (peer.token ?? undefined),
        {
          message: {
            messageId: `m-${crypto.randomUUID()}`,
            role: A2aRoles.User,
            parts: [{ text: input.task }],
            contextId,
            metadata: {
              ranch: {
                chain: [...input.inboundChain, input.callerAgentId],
                reason: input.reason,
              },
            },
          },
          configuration: {
            acceptedOutputModes: ['text/plain'],
            returnImmediately: false,
          },
        },
        timeoutMs,
        callable.dialect,
      );

      ({ status, errorCode, text } = readReply(reply));
      if (status === DelegationStatuses.Answered) {
        // An answer with nothing in it is still an answer — recorded as one,
        // and said out loud, so neither the audit row nor the model mistakes
        // silence for content (CLEAN-97).
        excerpt = text
          ? text.slice(0, DELEGATION_EXCERPT_CHARS)
          : EMPTY_REPLY_NOTE;
      } else {
        excerpt =
          ('task' in reply ? statusText(reply.task) : null) ??
          causeText(errorCode ?? null);
      }
    } catch (err) {
      errorCode =
        err instanceof DelegationError ? err.code : DelegationErrorCodes.Error;
      status = DelegationStatuses.Failed;
      excerpt = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Delegation ${row.id} to «${peerName}» failed: ${excerpt}`,
      );
    }

    const durationMs = Date.now() - startedAt;
    const finished = await this.delegations.finish(row.id, {
      status,
      errorCode: errorCode ?? null,
      excerpt,
      finishedAt: new Date(),
      durationMs,
    });

    this.publish(input.callerAgentId, turn, finished, masked);

    return {
      kind: 'done',
      status,
      peerName: shownName,
      masked,
      contextId,
      durationMs,
      ...(text !== undefined ? { text } : {}),
      ...(errorCode ? { errorCode } : {}),
      ...(excerpt ? { cause: excerpt } : {}),
    };
  }

  /**
   * Adds the step to the timeline the runtime already opened for this turn.
   * Silent when there is none: a delegation with no audience is still a
   * delegation, and inventing a turn would close the runtime's own block.
   */
  private publish(
    agentId: string,
    turn: { clientId: string; turnId: string } | null,
    row: Parameters<typeof buildDelegationStep>[0],
    masked: boolean,
  ): void {
    if (!turn) {
      this.logger.debug(
        `No active turn for agent=${agentId}; delegation ${row.id} runs without a visible step`,
      );
      return;
    }

    this.hub.sendToClient(turn.clientId, agentId, {
      type: 'thinking',
      clientId: turn.clientId,
      turnId: turn.turnId,
      ts: Date.now(),
      step: buildDelegationStep(row, { masked }),
    });
  }
}

/**
 * Which of the peer's advertised skills the model appears to have been going
 * for. Shown to the person as "what the card promised", so a rough overlap is
 * the right level of effort: the alternative is showing every skill, which
 * says nothing, or none, which says less.
 */
function matchSkills(peer: IAgentPeerData, context: string): IMatchedSkill[] {
  const skills = peer.cardSnapshot?.skills ?? [];
  if (skills.length === 0) return [];

  const words = new Set(
    context
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter((w) => w.length >= MEANINGFUL_WORD_CHARS),
  );

  const scored = skills
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description}`.toLowerCase();
      const hits = [...words].filter((w) => haystack.includes(w)).length;
      return { skill, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, MAX_MATCHED_SKILLS);

  // Nothing overlapped: name the first skill rather than nothing, so the step
  // still says what this peer is for.
  const chosen = scored.length ? scored.map((s) => s.skill) : [skills[0]];
  return chosen.map((s) => ({ id: s.id, name: s.name }));
}

type ReadReply = {
  status: DelegationStatus;
  errorCode?: DelegationErrorCode;
  text?: string;
};

/** A plain message is a direct, finished answer; a task says how it went. */
function readReply(reply: A2aSendMessageResult): ReadReply {
  if ('message' in reply) {
    return {
      status: DelegationStatuses.Answered,
      text: renderReplyParts(reply.message.parts),
    };
  }
  return readTask(reply.task);
}

function readTask(task: IA2aTask): ReadReply {
  switch (task.status.state) {
    case A2aTaskStates.Completed:
      return {
        status: DelegationStatuses.Answered,
        text: replyTextOfTask(task),
      };
    case A2aTaskStates.Rejected:
      return {
        status: DelegationStatuses.Rejected,
        errorCode:
          task.metadata?.ranch?.rejection === 'depth'
            ? DelegationErrorCodes.RejectedDepth
            : DelegationErrorCodes.RejectedLoop,
      };
    case A2aTaskStates.Failed:
      return {
        status: DelegationStatuses.Failed,
        errorCode:
          task.metadata?.ranch?.failure === 'timeout'
            ? DelegationErrorCodes.Timeout
            : task.metadata?.ranch?.failure === 'not_running'
              ? DelegationErrorCodes.NotRunning
              : DelegationErrorCodes.Error,
      };
    default:
      // Any other state means the peer is still working on something this
      // client has no way to poll — it cannot be reported as an answer.
      return {
        status: DelegationStatuses.Failed,
        errorCode: DelegationErrorCodes.Error,
      };
  }
}

/** The peer's own words about what went wrong, when it offered any. */
function statusText(task: IA2aTask): string | null {
  const text = renderReplyParts(task.status.message?.parts);
  return text ? text.slice(0, DELEGATION_EXCERPT_CHARS) : null;
}
