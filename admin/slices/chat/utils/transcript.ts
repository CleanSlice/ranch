import type { IChatMessage } from '#chat/stores/chat';

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
  /** null → standalone tool events with no assistant reply after them */
  message: IChatMessage | null;
  tools: IToolEvent[];
}

// Transcript reader renders tool_call as `name({...params})`.
const CALL_RE = /^([\w.$:-]+)\((.*)\)$/s;

/**
 * Groups a flat transcript for display: consecutive tool_call/tool_result
 * events pair up by order and attach to the next assistant reply — mirroring
 * how the agent produced them. Orphans (tools with no reply after, results
 * with no call) still surface as standalone items so nothing is hidden.
 */
export function groupTranscript(messages: IChatMessage[]): ITranscriptItem[] {
  const items: ITranscriptItem[] = [];
  let pending: { evt: IToolEvent; callTs: number; done: boolean }[] = [];

  function flushPending() {
    if (!pending.length) return;
    items.push({
      key: `tools-${pending[0]!.evt.id}`,
      message: null,
      tools: pending.map((p) => p.evt),
    });
    pending = [];
  }

  for (const m of messages) {
    if (m.role === 'tool_call') {
      const parsed = CALL_RE.exec(m.text.trim());
      pending.push({
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
      const open = pending.find((p) => !p.done);
      if (open) {
        open.evt.result = m.text;
        open.evt.durationMs = Math.max(0, m.ts - open.callTs);
        open.done = true;
      } else {
        pending.push({
          evt: { id: m.id, name: 'tool', args: '', result: m.text, durationMs: null },
          callTs: m.ts,
          done: true,
        });
      }
      continue;
    }
    if (m.role === 'assistant') {
      items.push({ key: m.id, message: m, tools: pending.map((p) => p.evt) });
      pending = [];
      continue;
    }
    // user / summary / system: tools never span across these — flush first
    flushPending();
    items.push({ key: m.id, message: m, tools: [] });
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

export function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
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
