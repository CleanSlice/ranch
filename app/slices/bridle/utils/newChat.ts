// When "New chat" is available, and what to say when it is not (CLEAN-136).
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.
//
// A reset is only offered when it can be a real one. The server refuses the
// same cases on its own (409 / 503) — these rules save the round trip and let
// the page say why before the person tries.

/** Why "New chat" is unavailable right now. */
export type NewChatBlocks =
  | 'busy'
  | 'empty'
  | 'offline'
  | 'agent_offline'
  | 'answering';

export interface INewChatInput {
  /** A reset for this conversation is already in flight. */
  resetting: boolean;
  messageCount: number;
  /** The live channel is up. */
  connected: boolean;
  /** The hub has said which chat identity this is (`welcome`). */
  hasClientId: boolean;
  /** Last `agent_status`; undefined until the hub has sent one. */
  agentOnline: boolean | undefined;
  /** A turn is visibly open: pending, thinking or streaming. */
  answering: boolean;
}

/**
 * The first reason that applies, or null when the action is available. The
 * order is the order a person would want to hear them in: what is already
 * happening, then what is true of the conversation, then of the connection,
 * then of the agent.
 */
export function newChatBlock(input: INewChatInput): NewChatBlocks | null {
  if (input.resetting) return 'busy';
  if (input.messageCount === 0) return 'empty';
  if (!input.connected || !input.hasClientId) return 'offline';
  if (input.agentOnline !== true) return 'agent_offline';
  if (input.answering) return 'answering';
  return null;
}

const HINT_KEYS: Record<NewChatBlocks, string> = {
  busy: 'chat.new_chat_starting',
  empty: 'chat.new_chat_empty',
  offline: 'chat.new_chat_offline',
  agent_offline: 'chat.new_chat_agent_offline',
  answering: 'chat.new_chat_answering',
};

/** The key of the sentence under the button: what it does, or why it cannot. */
export function newChatHintKey(block: NewChatBlocks | null): string {
  return block === null ? 'chat.new_chat_hint' : HINT_KEYS[block];
}

const FAILURE_KEYS: Record<string, string> = {
  AGENT_OFFLINE: 'chat.new_chat_failed_agent_offline',
  TURN_IN_PROGRESS: 'chat.new_chat_failed_answering',
};

/**
 * The key of the notice for a reset the server refused or could not do. A
 * code the console does not know — the API can add one — gets the general
 * sentence rather than the code itself.
 */
export function newChatFailureKey(code: string | undefined): string {
  return (code && FAILURE_KEYS[code]) || 'chat.new_chat_failed';
}
