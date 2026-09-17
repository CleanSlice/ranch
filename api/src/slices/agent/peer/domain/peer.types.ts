// Peer-connection domain contract (CLEAN-74). Pure types + constants: no
// Prisma, no DTOs, no Nest — the mappers convert records, the controllers
// convert DTOs.
//
// A peer connection is directed: "A holds B's card" says nothing about B. It
// carries a snapshot of the peer's card (so a peer editing its description
// mid-turn cannot change how A behaves until someone presses Refresh) and a
// credential scoped to exactly this (caller, peer) pair.

import * as crypto from 'crypto';
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

/** Where a peer connection points (CLEAN-95). Internal rows reference another
 *  agent of this installation; external rows know only a card URL. */
export const PeerOrigins = {
  Internal: 'internal',
  External: 'external',
} as const;

export type PeerOrigin = (typeof PeerOrigins)[keyof typeof PeerOrigins];

/** `peerStatus` shown for external rows — the console cannot know a foreign
 *  pod's live status, so the origin doubles as the status. */
export const EXTERNAL_PEER_STATUS = 'external';

/** Machine-readable codes carried in the error body so the console can tell
 *  the failure modes apart without parsing messages. */
export const PeerErrorCodes = {
  Self: 'PEER_SELF',
  Exists: 'PEER_EXISTS',
  NotFound: 'PEER_NOT_FOUND',
  CardUnreachable: 'PEER_CARD_UNREACHABLE',
  Unauthorized: 'A2A_UNAUTHORIZED',
  // External import (CLEAN-95).
  Body: 'PEER_BODY',
  UrlInvalid: 'PEER_URL_INVALID',
  UrlUnreachable: 'PEER_URL_UNREACHABLE',
  Version: 'PEER_VERSION',
  SelfUrl: 'PEER_SELF_URL',
  // A 1.0 card with no JSON-RPC interface (CLEAN-97).
  Binding: 'PEER_BINDING',
} as const;

export type PeerErrorCode =
  (typeof PeerErrorCodes)[keyof typeof PeerErrorCodes];

/** One persisted peer connection. Dates are ISO strings — the domain never
 *  handles `Date` instances so the state can be serialised as-is. */
export interface IAgentPeerData {
  id: string;
  /** The caller: the agent that holds the card. */
  agentId: string;
  /** The peer agent, or null for an external row known only by URL. */
  peerAgentId: string | null;
  origin: PeerOrigin;
  /** Pair credential (internal rows only). Never leaves the API — no DTO
   *  carries it. */
  token: string | null;
  /** Bearer presented to an external agent. Write-only, like `token`. */
  outboundToken: string | null;
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
  /** Null for external rows. */
  peerAgentId: string | null;
  origin: PeerOrigin;
  peerName: string;
  /** AgentStatusTypes as a plain string; 'running' ⇒ delegation can succeed.
   *  External rows carry EXTERNAL_PEER_STATUS — no live status is knowable. */
  peerStatus: string;
  /** False when the peer agent is gone (only reachable for a remote peer). */
  peerExists: boolean;
  card: IA2aAgentCard;
  cardUrl: string;
  cardReadAt: string;
  createdAt: string;
}

/** Whether the running pod has loaded the current peer set (CLEAN-95). */
export interface IPeersState {
  armed: boolean;
  servedAt: string | null;
}

/**
 * Identity of a peer SET, order-independent. Membership is the only thing a
 * restart is needed for — the tool re-reads descriptions on every list — so
 * the hash covers row ids and nothing else.
 */
export function hashPeerIds(ids: string[]): string {
  return crypto
    .createHash('sha256')
    .update([...ids].sort().join('\n'))
    .digest('hex');
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
  // The stored card's interface resolves to a private or local address, so
  // no request was sent (CLEAN-97).
  AddressRefused: 'PEER_ADDRESS_REFUSED',
  // The stored card offers no JSON-RPC interface on A2A 1.0 (CLEAN-97).
  Unsupported: 'PEER_UNSUPPORTED',
} as const;

/** What the audit row and the visible step say when a peer answered with
 *  nothing readable — no text, no data, no link (CLEAN-97). */
export const EMPTY_REPLY_NOTE =
  'The peer answered, but its reply had no text, data or links.';

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
  /** Null for delegations to external peers (CLEAN-95). */
  peerAgentId: string | null;
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
  peerAgentId: string | null;
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

/** The peer's card could not be read at connect or refresh time.
 *  `kind` separates "could not reach it" from "reached it, not a card" so an
 *  external import can answer 502 vs 400 honestly (CLEAN-95), and "it is a
 *  card, of a protocol version we do not speak" from both (CLEAN-97). */
export class PeerCardUnreachableError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly kind: 'unreachable' | 'invalid' | 'version' = 'unreachable',
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
