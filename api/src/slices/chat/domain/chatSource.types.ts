/**
 * Sources an answer drew on (CLEAN-138). The chat slice owns the *citation*:
 * which source a bubble pointed at, under which number, for whom. The
 * knowledge slice owns the source itself and its policy; the bridle slice
 * owns the wire. Shapes here are the contract in
 * specs/020-chat-sources/contracts/sources.md.
 */

import { IChatAgentScope } from './chat.types';

/** A source as the runtime names it in its `sources` event (and as a tool
 * result carries it). `id` is the Ranch Source id. */
export type IChatSourceInput =
  | {
      kind: 'knowledge';
      id: string;
      name: string;
      knowledgeId: string;
      knowledgeName: string | null;
    }
  | { kind: 'web'; url: string; title: string | null };

export type ChatSourceKinds = 'knowledge' | 'web';

/**
 * A source as a reader sees it, addressed by `(messageId, n)`. The Source id,
 * knowledge id and storage location never leave the API. `canOpen` is
 * computed when served — the base's reader-access policy is read on every
 * request, never stamped on the row — so a keeper closing a base takes effect
 * on the next load of every answer that cited it.
 */
export interface IChatSourceEntry {
  n: number;
  kind: ChatSourceKinds;
  name: string;
  url?: string;
  knowledgeName?: string | null;
  canOpen: boolean;
  myRating?: 1 | -1;
}

/** One ChatMessageSource row. */
export interface IChatMessageSourceData {
  id: string;
  agentId: string;
  clientId: string;
  sessionKey: string;
  messageId: string;
  n: number;
  kind: ChatSourceKinds;
  sourceId: string | null;
  knowledgeId: string | null;
  knowledgeName: string | null;
  name: string;
  url: string | null;
  createdAt: Date;
}

export type ICreateChatMessageSource = Omit<
  IChatMessageSourceData,
  'id' | 'createdAt'
>;

/** What the hub hands over when the runtime's `sources` event arrives. */
export interface IRecordSourcesInput {
  agentId: string;
  clientId: string;
  messageId: string;
  sources: IChatSourceInput[];
}

/**
 * Who is looking. `admin` is the shared console identity (Owner/Admin
 * tokens); it reads every conversation and opens documents whatever the
 * policy says, as it does in the knowledge console.
 */
export interface IChatSourceViewer {
  clientId: string;
  isAdmin: boolean;
}

// ── What a statistics view reads (CLEAN-258, docs/statistics.md) ──

/**
 * The citations of one chat identity with `createdAt` in `[from, to]`, both
 * ends included. `agentScope` is what `AgentReach.where()` hands back: the
 * agents the person reaches. Absent, no agent is left out.
 */
export interface ICitationRange {
  clientId: string;
  from: Date;
  to: Date;
  agentScope?: IChatAgentScope;
}

/** One answer that cited at least one source: whose it was and when. */
export interface ICitedAnswer {
  agentId: string;
  messageId: string;
  /** When its first source was recorded. */
  at: Date;
}

/**
 * Citations counted as the rows name their source: the base's id and its
 * name as it was when cited, or the web. A base renamed inside the range
 * arrives as two groups with one `knowledgeId`.
 */
export interface ICitationGroup {
  kind: ChatSourceKinds;
  knowledgeId: string | null;
  knowledgeName: string | null;
  citations: number;
  lastCitedAt: Date;
}

/** How often one source was cited: a knowledge base, or the web. */
export interface ICitedSource {
  /** The base's name, or `WEB_SOURCE_NAME` for every web page together. */
  name: string;
  citations: number;
}

/** The name every web citation is counted under. */
export const WEB_SOURCE_NAME = 'web';

/** What `ChatSourceService.citedForClient` answers. */
export interface ICitedForClient {
  /**
   * One entry per answer that came with sources, oldest first. A citation
   * names its agent and its moment, not its conversation (the row has no
   * key to one, and outlives it), so whoever counts conversations matches
   * these against the hours the conversations were active in.
   */
  answers: { agentId: string; at: Date }[];
  /** Every source that can be named, most cited first, equal ones by name. */
  sources: ICitedSource[];
}

/** The most entries one bubble may cite; more is a runaway, not an answer. */
export const CHAT_SOURCES_MAX = 50;

/** Only ordinary web addresses are ever made clickable (FR-015). */
export function isWebUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url);
}
