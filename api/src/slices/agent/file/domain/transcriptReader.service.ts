import { Injectable } from '@nestjs/common';
import { IFileGateway } from './file.gateway';

/** One replayable line of a chat transcript. `role` is the source Event type. */
export interface TranscriptMessage {
  id: string;
  role:
    | 'user'
    | 'assistant'
    | 'summary'
    | 'tool_call'
    | 'tool_result'
    | 'system';
  text: string;
  ts: number;
}

export interface ReadTranscriptOptions {
  /** Event types to surface. Default: `['user', 'assistant']`. */
  types?: TranscriptMessage['role'][];
  /**
   * Drop synthetic loop-control events (continuation prompts + partial
   * assistant chunks) so the transcript reads cleanly and has no duplicates.
   * Default: true. Pass false to preserve raw file order byte-for-byte
   * (the bridle widget replay does this).
   */
  filterTransient?: boolean;
}

// Streamed in 512 KB blocks; hard-capped so a pathological session file can't
// blow the heap — anything bigger should be exported via the Files ZIP.
const BLOCK_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

// Prefix shared by both continuation prompts injected by the runtime loop
// (CONTINUATION_PROMPT and buildAnchoredContinuationPrompt) — the reliable
// legacy signal for data written before the `data.transient` marker existed.
const CONTINUATION_PREFIX = 'Your response was cut off';

interface RawEvent {
  id?: string;
  type?: string;
  ts?: number;
  data?: {
    text?: string;
    transient?: boolean;
    name?: string;
    params?: unknown;
    result?: unknown;
  };
}

/**
 * Reads an agent's append-only JSONL session transcript from S3 (via
 * IFileGateway) and turns it into replayable messages. Shared by the bridle
 * widget replay and the admin chat-history view.
 *
 * Two behaviors layered on top of the raw read (both opt-in via options):
 *  - hygiene: filter runtime loop-control noise (fix 8) — continuation prompts
 *    and the pre-cutoff partial assistant chunk that is re-emitted in full.
 *  - `summary` events are surfaced as a collapsed marker (compaction folds old
 *    turns into a summary; hiding it would leave a silent gap in the history).
 */
@Injectable()
export class TranscriptReaderService {
  constructor(private readonly files: IFileGateway) {}

  /** Full transcript, oldest-first. Callers paginate with {@link page}. */
  async read(
    agentId: string,
    path: string,
    opts: ReadTranscriptOptions = {},
  ): Promise<TranscriptMessage[]> {
    const types = new Set<string>(opts.types ?? ['user', 'assistant']);
    const filterTransient = opts.filterTransient ?? true;

    const events = this.parse(await this.readRaw(agentId, path));
    const transient = filterTransient
      ? this.markTransient(events)
      : new Set<number>();

    const messages: TranscriptMessage[] = [];
    events.forEach((evt, i) => {
      if (transient.has(i)) return;
      if (!evt.type || !evt.id || typeof evt.ts !== 'number') return;
      if (!types.has(evt.type)) return;
      const text = this.render(evt);
      if (text === null) return;
      messages.push({
        id: evt.id,
        role: evt.type as TranscriptMessage['role'],
        text,
        ts: evt.ts,
      });
    });
    messages.sort((a, b) => a.ts - b.ts);
    return messages;
  }

  /**
   * Tail-first cursor pagination over an already-read message list. Cursor is
   * the index into the sorted-ascending list where the next (older) page ENDS,
   * exclusive; omit it for the latest page. Mirrors the bridle transcript API.
   */
  static page(
    all: TranscriptMessage[],
    cursor: string | undefined,
    limit: number,
  ): {
    messages: TranscriptMessage[];
    nextCursor: string | null;
    hasMore: boolean;
  } {
    const end = TranscriptReaderService.parseCursor(cursor, all.length);
    const start = Math.max(0, end - limit);
    const hasMore = start > 0;
    return {
      messages: all.slice(start, end),
      nextCursor: hasMore ? String(start) : null,
      hasMore,
    };
  }

  private static parseCursor(
    cursor: string | undefined,
    total: number,
  ): number {
    if (!cursor) return total;
    const parsed = parseInt(cursor, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return total;
    return Math.min(parsed, total);
  }

  private async readRaw(agentId: string, path: string): Promise<string> {
    let content = '';
    let offset = 0;
    for (;;) {
      const chunk = await this.files.readRange(
        agentId,
        path,
        offset,
        BLOCK_BYTES,
      );
      content += chunk.content;
      if (content.length > MAX_TRANSCRIPT_BYTES) {
        throw new Error(
          `Transcript exceeds ${MAX_TRANSCRIPT_BYTES} bytes — export via Files instead`,
        );
      }
      if (!chunk.hasMore || chunk.nextOffset === null) break;
      offset = chunk.nextOffset;
    }
    return content;
  }

  private parse(content: string): RawEvent[] {
    const events: RawEvent[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as RawEvent);
      } catch {
        // JSONL writers occasionally truncate the tail mid-flush; one bad
        // line shouldn't kill the whole replay.
      }
    }
    return events;
  }

  // Indices (in file/append order) of runtime loop-control noise to drop:
  //  - any event explicitly tagged `data.transient` (new data);
  //  - a `user` continuation prompt (legacy: text starts with the known prefix);
  //  - an `assistant` immediately followed by such a continuation `user` — that
  //    is the pre-cutoff partial chunk; the final full assistant is re-emitted
  //    later, so keeping the partial would duplicate content.
  private markTransient(events: RawEvent[]): Set<number> {
    const isContinuationUser = (e?: RawEvent): boolean =>
      !!e &&
      e.type === 'user' &&
      (e.data?.transient === true ||
        (typeof e.data?.text === 'string' &&
          e.data.text.startsWith(CONTINUATION_PREFIX)));

    const drop = new Set<number>();
    events.forEach((e, i) => {
      if (e.data?.transient === true) drop.add(i);
      if (isContinuationUser(e)) drop.add(i);
      if (e.type === 'assistant' && isContinuationUser(events[i + 1]))
        drop.add(i);
    });
    return drop;
  }

  // Renders an event to display text. Returns null to skip (e.g. empty body).
  private render(evt: RawEvent): string | null {
    if (evt.type === 'user' || evt.type === 'assistant') {
      return evt.data?.text ? evt.data.text : null;
    }
    if (evt.type === 'summary') {
      // Compaction stores the archive under data.text already wrapped in
      // [ARCHIVED CONTEXT …] markers; surface it as-is so the UI can collapse it.
      return evt.data?.text ? evt.data.text : null;
    }
    if (evt.type === 'tool_call') {
      const name = evt.data?.name ?? 'tool';
      return `${name}(${this.truncate(JSON.stringify(evt.data?.params ?? {}))})`;
    }
    if (evt.type === 'tool_result') {
      return this.truncate(
        typeof evt.data?.result === 'string'
          ? evt.data.result
          : JSON.stringify(evt.data?.result ?? ''),
      );
    }
    if (evt.type === 'system') {
      return evt.data?.text ? evt.data.text : null;
    }
    return null;
  }

  private truncate(s: string, max = 2000): string {
    return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} chars]` : s;
  }
}
