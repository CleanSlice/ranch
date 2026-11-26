// What the agent panel shows under the sheet, read from the address of the
// agent page (CLEAN-248): the chat, the list of this agent's conversations,
// or one closed conversation. It lives in the address so that a reload and
// the browser's Back work, and so that opening another agent, whose address
// carries no query, starts in the chat.
// Pure on purpose: no Vue, no Nuxt aliases, so `bun test` runs it.

export type PanelView =
  | { kind: 'chat' }
  | { kind: 'list' }
  | { kind: 'conversation'; chatId: string };

export interface IPanelLocation {
  path: string;
  query: Record<string, string>;
}

const HISTORY = 'history';

/**
 * Two digits fit the switch when it is drawn as icons; beyond that the exact
 * number is in the button's accessible name.
 */
const COUNTER_CAP = 99;

/** A query value as one string: the first of a repeated parameter, or none. */
function single(value: unknown): string | null {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : null;
}

/** Anything the address does not spell out as history is the chat. */
export function parsePanelView(query: Record<string, unknown>): PanelView {
  if (single(query.view) !== HISTORY) return { kind: 'chat' };
  const chatId = single(query.chat);
  return chatId ? { kind: 'conversation', chatId } : { kind: 'list' };
}

export function panelLocation(agentId: string, view: PanelView): IPanelLocation {
  const path = `/agents/${encodeURIComponent(agentId)}`;
  if (view.kind === 'list') return { path, query: { view: HISTORY } };
  if (view.kind === 'conversation') {
    return { path, query: { view: HISTORY, chat: view.chatId } };
  }
  return { path, query: {} };
}

/** One step back: conversation, list, chat. Nothing is behind the chat. */
export function stepBack(view: PanelView): PanelView | null {
  if (view.kind === 'conversation') return { kind: 'list' };
  if (view.kind === 'list') return { kind: 'chat' };
  return null;
}

/** The History counter: absent at zero or while unknown, capped at 99+. */
export function counterLabel(total: number | null | undefined): string | null {
  if (!total || total < 1) return null;
  return total > COUNTER_CAP ? `${COUNTER_CAP}+` : String(total);
}
