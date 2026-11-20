// Pure helpers behind the admin chat list: who the user of a session is, how
// its id is shown, and how a page of sessions folds into day groups. No Vue
// in here, so the test runs without a component around it.

import { dayKey } from '#common/utils/format';
import type { IChatSession } from '../domain/chat.types';

/**
 * What a session's user is. The API says who a signed-in person is and
 * whether another agent handed the conversation over (CLEAN-236); the rest
 * is read off the client id the channel assigned: `share-…` a share-link
 * visitor, `anon-…` a public-agent visitor, `http-…` / `sync-…` a machine
 * caller, a Telegram or Slack session carries the chat title or username,
 * and any other bridle id is an embed JWT subject — a web visitor.
 *
 * `admin` used to be one conversation of every Owner and Admin, shown as
 * "Admin". It is the Owner's own now, and an Admin's is under their own id:
 * both are `person`, by name.
 */
export type ChatUserKind =
  | 'person'
  | 'peer'
  | 'admin'
  | 'share'
  | 'anonymous'
  | 'machine'
  | 'internal'
  | 'telegram'
  | 'slack'
  | 'visitor';

export interface ChatUser {
  kind: ChatUserKind;
  /** The badge text. */
  label: string;
  /** The id as shown next to the badge: prefix dropped, long ids cut. */
  id: string;
  /** The id in full, for the tooltip. */
  fullId: string;
}

const ID_PREFIXES = ['share-', 'anon-', 'http-', 'sync-'];
// A generated slug (`smooth-teams-awew8vx7se4p`) fits, a uuid does not.
const SHOWN_ID_MAX = 32;
const SHOWN_ID_HEAD = 8;

/** Drops a known prefix and cuts an id longer than a slug down to `8…`. */
export function shownId(fullId: string): string {
  let id = fullId;
  for (const prefix of ID_PREFIXES) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
      break;
    }
  }
  return id.length > SHOWN_ID_MAX ? `${id.slice(0, SHOWN_ID_HEAD)}…` : id;
}

export function chatUser(s: IChatSession): ChatUser {
  const fullId = s.externalUserId;
  const base = { fullId, id: shownId(fullId) };
  if (s.channel === 'internal') return { ...base, kind: 'internal', label: 'Internal' };
  if (s.channel === 'telegram') return { ...base, kind: 'telegram', label: s.title || 'Telegram' };
  if (s.channel === 'slack') return { ...base, kind: 'slack', label: s.title || 'Slack' };
  // Another agent's question. Its name only when the API gave one, which it
  // does for a viewer who has access to that agent; the id is a connection's
  // (an agent's, on a conversation stored before CLEAN-236) and is not shown.
  if (s.peer || fullId.startsWith('peer:')) {
    return { fullId: '', id: '', kind: 'peer', label: s.peer?.name || 'Colleague' };
  }
  if (s.person) {
    const role = s.person.role === 'Owner' || s.person.role === 'Admin' ? s.person.role : '';
    return {
      ...base,
      kind: 'person',
      label: s.person.name || 'Removed account',
      // The role where it says something: an administrator's conversation
      // among the visitors'. A user id next to a name says nothing.
      id: role,
    };
  }
  // An API older than the `person` field: the conversation every
  // administrator shared.
  if (fullId === 'admin') return { ...base, kind: 'admin', label: 'Admin', id: '' };
  if (fullId.startsWith('share-')) return { ...base, kind: 'share', label: 'Share link' };
  if (fullId.startsWith('anon-')) return { ...base, kind: 'anonymous', label: 'Anonymous' };
  if (fullId.startsWith('http-') || fullId.startsWith('sync-')) {
    return { ...base, kind: 'machine', label: 'Machine' };
  }
  return { ...base, kind: 'visitor', label: s.title || 'Web visitor' };
}

/**
 * A conversation rather than a single exchange: more than one question and
 * one answer. The count pill stands out for these.
 */
export function isConversation(s: IChatSession): boolean {
  return s.messageCount > 2;
}

export interface ChatDayGroup {
  /** `2026-10-19`, the viewer's own day. */
  key: string;
  /** The newest session's instant, for the heading and its distance. */
  at: string;
  sessions: IChatSession[];
}

/**
 * Folds a page of sessions into day groups, keeping the server's order
 * (newest first) inside and across groups. A session with an unreadable
 * date lands in a group of its own with an empty key.
 */
export function groupByDay(sessions: IChatSession[]): ChatDayGroup[] {
  const groups: ChatDayGroup[] = [];
  for (const s of sessions) {
    const key = dayKey(s.lastMessageAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.sessions.push(s);
    else groups.push({ key, at: s.lastMessageAt, sessions: [s] });
  }
  return groups;
}

/** `1 chat`, `3 chats`. */
export function chatCountLabel(n: number): string {
  return n === 1 ? '1 chat' : `${n} chats`;
}
