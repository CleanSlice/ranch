/**
 * Sources an answer drew on (CLEAN-138). The chat slice owns the *citation*:
 * which source a bubble pointed at, under which number, for whom. The
 * knowledge slice owns the source itself and its policy; the bridle slice
 * owns the wire. Shapes here are the contract in
 * specs/020-chat-sources/contracts/sources.md.
 */

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

/** The most entries one bubble may cite; more is a runaway, not an answer. */
export const CHAT_SOURCES_MAX = 50;

/** Only ordinary web addresses are ever made clickable (FR-015). */
export function isWebUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url);
}
