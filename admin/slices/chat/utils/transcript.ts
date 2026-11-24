import type { IChatMessage } from '#chat/stores/chat';
import { formatStamp } from '#common/utils/format';
import type { IThinkingBlock } from '#bridle/stores/bridle';
import { interimStep } from '#bridle/utils/interim';

export interface IToolEvent {
  id: string;
  name: string;
  args: string;
  result: string | null;
  durationMs: number | null;
}

export interface INavMapItem {
  id: string;
  isUser: boolean;
  snippet: string;
}

export interface ITranscriptItem {
  key: string;
  /** null → what led up to no reply: tools or thinking with no assistant reply after them */
  message: IChatMessage | null;
  tools: IToolEvent[];
  /**
   * The narration that led up to the reply (CLEAN-242), as the thinking block
   * the live chat showed — with the tools of the same stretch as steps, in
   * order, so the block reads as it happened. null when there was none or
   * thinking is hidden; the tools then render as rows of their own.
   */
  thinking: IThinkingBlock | null;
}

export interface IGroupTranscriptOptions {
  /** Fold narration into thinking blocks (default); false drops it. */
  thinking?: boolean;
}

// Transcript reader renders tool_call as `name({...params})`.
const CALL_RE = /^([\w.$:-]+)\((.*)\)$/s;

/**
 * Groups a flat transcript for display: consecutive tool_call/tool_result
 * events pair up by order and attach to the next assistant reply — mirroring
 * how the agent produced them. Narration bubbles (`interim`, CLEAN-189) are
 * not replies: they join the same stretch and become a thinking block above
 * the reply, the way the live chat showed them (CLEAN-242). Orphans (tools or
 * narration with no reply after, results with no call) still surface as
 * standalone items so nothing is hidden.
 */
export function groupTranscript(
  messages: IChatMessage[],
  options: IGroupTranscriptOptions = {},
): ITranscriptItem[] {
  const showThinking = options.thinking ?? true;
  const items: ITranscriptItem[] = [];
  type Pending =
    | { kind: 'tool'; evt: IToolEvent; callTs: number; done: boolean }
    | { kind: 'note'; message: IChatMessage };
  let pending: Pending[] = [];

  function tools(): IToolEvent[] {
    const out: IToolEvent[] = [];
    for (const p of pending) if (p.kind === 'tool') out.push(p.evt);
    return out;
  }

  function thinking(): IThinkingBlock | null {
    const first = pending.find((p) => p.kind === 'note');
    if (!first || first.kind !== 'note') return null;
    return {
      turnId: `history:${first.message.id}`,
      seg: 0,
      steps: pending.map((p) =>
        p.kind === 'note'
          ? interimStep(p.message)
          : { id: p.evt.id, label: p.evt.name, state: 'done' as const },
      ),
      status: 'done',
      ts: first.message.ts,
    };
  }

  function take(message: IChatMessage | null, key: string): ITranscriptItem {
    const item = { key, message, tools: tools(), thinking: thinking() };
    pending = [];
    return item;
  }

  function flushPending() {
    if (!pending.length) return;
    const first = pending[0]!;
    items.push(take(null, `steps-${first.kind === 'tool' ? first.evt.id : first.message.id}`));
  }

  for (const m of messages) {
    if (m.role === 'tool_call') {
      const parsed = CALL_RE.exec(m.text.trim());
      pending.push({
        kind: 'tool',
        evt: {
          id: m.id,
          name: parsed?.[1] ?? 'tool',
          args: parsed?.[2] ?? m.text,
          result: null,
          durationMs: null,
        },
        callTs: m.ts,
        done: false,
      });
      continue;
    }
    if (m.role === 'tool_result') {
      const open = pending.find((p) => p.kind === 'tool' && !p.done);
      if (open && open.kind === 'tool') {
        open.evt.result = m.text;
        open.evt.durationMs = Math.max(0, m.ts - open.callTs);
        open.done = true;
      } else {
        pending.push({
          kind: 'tool',
          evt: { id: m.id, name: 'tool', args: '', result: m.text, durationMs: null },
          callTs: m.ts,
          done: true,
        });
      }
      continue;
    }
    if (m.role === 'assistant' && m.interim) {
      if (showThinking) pending.push({ kind: 'note', message: m });
      continue;
    }
    if (m.role === 'assistant') {
      items.push(take(m, m.id));
      continue;
    }
    // user / summary / system: tools never span across these — flush first
    flushPending();
    items.push({ key: m.id, message: m, tools: [], thinking: null });
  }
  flushPending();
  return items;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** `00:46` today, `Aug 21, 00:46` earlier — English in every browser. */
export function formatMessageTime(ts: number, now: Date = new Date()): string {
  return formatStamp(ts, now);
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
