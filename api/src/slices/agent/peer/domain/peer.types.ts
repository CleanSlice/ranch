// Peer-connection domain contract (CLEAN-74). Pure types + constants: no
// Prisma, no DTOs, no Nest — the mappers convert records, the controllers
// convert DTOs.
//
// A peer connection is directed: "A holds B's card" says nothing about B. It
// carries a snapshot of the peer's card (so a peer editing its description
// mid-turn cannot change how A behaves until someone presses Refresh) and a
// credential scoped to exactly this (caller, peer) pair.

import type { IA2aAgentCard } from './a2a.types';

/** Token prefix. Makes a peer credential impossible to confuse with a share
 *  link (`sl_`), an API key (`rk_`), a session secret (`rs_`) or a JWT. */
export const PEER_TOKEN_PREFIX = 'ap_';

/** Entropy of the secret: 32 random bytes ⇒ 43 base64url chars (~256 bits). */
export const PEER_TOKEN_BYTES = 32;

/** Shape a presented credential must have before it is worth a lookup. */
export const PEER_TOKEN_RE = /^ap_[A-Za-z0-9_-]{43}$/;

/**
 * Bridle client id a peer conversation registers under. One conversation per
 * (caller, context) pair, and the prefix keeps it apart from `admin`, `share-`,
 * `anon-`, `http-` and `sync-` ids in the chat history.
 */
export const PEER_CLIENT_PREFIX = 'peer:';

export function peerClientId(callerAgentId: string, contextId: string): string {
  return `${PEER_CLIENT_PREFIX}${callerAgentId}:${contextId}`;
}

/** Thinking-step id prefix, so a delegation's two pushes replace each other. */
export const DELEGATION_STEP_PREFIX = 'delegation:';

/** Default hops allowed beyond the agent the person is talking to (env
 *  `A2A_MAX_CHAIN`). 3 is the smallest number that still allows A→B→C. */
export const DEFAULT_MAX_CHAIN = 3;

/** Default delegation wait (env `A2A_SYNC_TIMEOUT_MS`) — the same ceiling the
 *  synchronous chat route uses. */
export const DEFAULT_A2A_TIMEOUT_MS = 120_000;

/** How much of a peer's reply travels into the visible step and the audit row. */
export const DELEGATION_EXCERPT_CHARS = 300;

/** Machine-readable codes carried in the error body so the console can tell
 *  the failure modes apart without parsing messages. */
export const PeerErrorCodes = {
  Self: 'PEER_SELF',
  Exists: 'PEER_EXISTS',
  NotFound: 'PEER_NOT_FOUND',
  CardUnreachable: 'PEER_CARD_UNREACHABLE',
  Unauthorized: 'A2A_UNAUTHORIZED',
} as const;

export type PeerErrorCode = (typeof PeerErrorCodes)[keyof typeof PeerErrorCodes];

/** One persisted peer connection. Dates are ISO strings — the domain never
 *  handles `Date` instances so the state can be serialised as-is. */
export interface IAgentPeerData {
  id: string;
  /** The caller: the agent that holds the card. */
  agentId: string;
  /** The peer: the agent whose card is held. */
  peerAgentId: string;
  /** Pair credential. Never leaves the API — no DTO carries it. */
  token: string;
  cardSnapshot: IA2aAgentCard;
  cardUrl: string;
  cardReadAt: string;
  createdAt: string;
  updatedAt: string;
}

/** A peer connection joined with what the peer agent looks like right now. */
export interface IAgentPeerView {
  id: string;
  agentId: string;
  peerAgentId: string;
  peerName: string;
  /** AgentStatusTypes as a plain string; 'running' ⇒ delegation can succeed. */
  peerStatus: string;
  /** False when the peer agent is gone (only reachable for a remote peer). */
  peerExists: boolean;
  card: IA2aAgentCard;
  cardUrl: string;
  cardReadAt: string;
  createdAt: string;
}

/** An agent offered in the "add peer" picker. */
export interface IAgentPeerCandidate {
  id: string;
  name: string;
  status: string;
  connected: boolean;
}

// ── Delegations ─────────────────────────────────────────────────

export const DelegationStatuses = {
  Waiting: 'waiting',
  Answered: 'answered',
  Failed: 'failed',
  Rejected: 'rejected',
} as const;

export type DelegationStatus =
  (typeof DelegationStatuses)[keyof typeof DelegationStatuses];

/** Why a delegation did not produce an answer. Rendered to the person in
 *  product wording, never as raw error text. */
export const DelegationErrorCodes = {
  NotRunning: 'PEER_NOT_RUNNING',
  Timeout: 'PEER_TIMEOUT',
  RejectedLoop: 'PEER_REJECTED_LOOP',
  RejectedDepth: 'PEER_REJECTED_DEPTH',
  Unauthorized: 'PEER_UNAUTHORIZED',
  Unreachable: 'PEER_UNREACHABLE',
  Error: 'PEER_ERROR',
} as const;

export type DelegationErrorCode =
  (typeof DelegationErrorCodes)[keyof typeof DelegationErrorCodes];

/** A card skill quoted in the visible step as the reason a peer was chosen. */
export interface IMatchedSkill {
  id: string;
  name: string;
}

/** One task handed to a peer during one chat turn — the durable audit row. */
export interface IAgentDelegationData {
  id: string;
  agentId: string;
  /** Null once the connection it was made through has been removed. */
  peerId: string | null;
  peerAgentId: string;
  peerName: string;
  contextId: string;
  /** The caller's thinking turn, when one was known at the time. */
  turnId: string | null;
  clientId: string | null;
  task: string;
  reason: string;
  matchedSkills: IMatchedSkill[];
  status: DelegationStatus;
  errorCode: DelegationErrorCode | null;
  excerpt: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface ICreateDelegationData {
  agentId: string;
  peerId: string;
  peerAgentId: string;
  peerName: string;
  contextId: string;
  turnId?: string | null;
  clientId?: string | null;
  task: string;
  reason: string;
  matchedSkills: IMatchedSkill[];
}

export interface IFinishDelegationData {
  status: DelegationStatus;
  errorCode?: DelegationErrorCode | null;
  excerpt?: string | null;
  finishedAt: Date;
  durationMs: number;
}

// ── Errors raised by the outbound client ────────────────────────

/** The peer's card could not be read at connect or refresh time. */
export class PeerCardUnreachableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PeerCardUnreachableError';
  }
}

/** A delegation could not be completed. `code` decides the product wording. */
export class DelegationError extends Error {
  constructor(
    public readonly code: DelegationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DelegationError';
  }
}
