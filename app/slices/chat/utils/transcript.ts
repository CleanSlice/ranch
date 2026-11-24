import { formatStamp } from '../../common/utils/format';
import {
  BridleThinkingBlockStates,
  type IBridleThinkingBlock,
} from '../../bridle/domain/bridle.types';
import { interimStep } from '../../bridle/utils/interim';
import type { IChatMessage } from '../domain/chat.types';

export interface INavMapItem {
  id: string;
  isUser: boolean;
  snippet: string;
}

/**
 * When a message was sent: the time today, `Aug 21, 12:46 AM` · `21 авг., 00:46`
 * earlier. `locale` is required — left out, the date would follow the browser
 * instead of the language the customer picked.
 */
export function formatMessageTime(ts: number, locale: string, now: Date = new Date()): string {
  return formatStamp(locale, ts, now);
}

/** One-line plain-text snippet for the navigation mini-map. */
export function snippet(text: string, max = 64): string {
  const line =
    text
      .split('\n')
      .map((l) => l.replace(/[#*_`>~-]/g, '').trim())
      .find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export interface IHistoryItem {
  key: string;
  /** null → narration with no reply after it */
  message: IChatMessage | null;
  /** The thinking block above the reply, when the agent narrated first. */
  thinking: IBridleThinkingBlock | null;
}

/**
 * Narration the agent wrote before calling a tool (`interim`, CLEAN-189) is
 * not a reply: the live chat showed it inside a thinking block, so the
 * history does too (CLEAN-242). A run of it attaches to the reply after it;
 * a run with no reply after it stands on its own. Everything else passes
 * through in order. Twin of admin's `groupTranscript`, minus the tool events
 * this console never receives.
 */
export function foldThinking(messages: readonly IChatMessage[]): IHistoryItem[] {
  const items: IHistoryItem[] = [];
  let run: IChatMessage[] = [];
  const block = (): IBridleThinkingBlock | null => {
    const first = run[0];
    if (!first) return null;
    const thinking = {
      turnId: `history:${first.id}`,
      seg: 0,
      steps: run.map(interimStep),
      state: BridleThinkingBlockStates.Done,
      ts: first.ts,
    };
    run = [];
    return thinking;
  };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i] as IChatMessage;
    if (m.role === 'assistant' && m.interim) {
      run.push(m);
    } else if (m.role === 'assistant') {
      items.push({ key: m.id, message: m, thinking: block() });
    } else {
      const key = run[0] ? `thinking-${run[0].id}` : null;
      const thinking = block();
      if (key && thinking) items.push({ key, message: null, thinking });
      items.push({ key: m.id, message: m, thinking: null });
    }
  }
  const key = run[0] ? `thinking-${run[0].id}` : null;
  const thinking = block();
  if (key && thinking) items.push({ key, message: null, thinking });
  return items;
}
