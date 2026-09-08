/**
 * The attachment block: the text appended to a person's message for each
 * file they attached, and the grammar used to take it out again.
 *
 * Both directions live here on purpose. The runtime persists the composed
 * message as one string, so the only way a replay surface can show what the
 * person typed is to recognise the blocks and cut them off. If the writer
 * and the reader ever disagree, bubbles fill with spreadsheet dumps again.
 *
 * Grammar (see specs/009-attachment-parse-quality/contracts/agent-facing-document.md):
 *
 *   <typed text>\n\n<block>\n\n<block>…
 *
 *   block := header "\n" fence "\n" body "\n" fence      (fenced)
 *          | notice-line                                 (notice)
 *   header := "[Attached file: " name " — id: " uuid "]" hint?
 *           | "[Attached file: " name "]"                (legacy)
 *   fence  := "```" | "````" | …  (wider than any run inside the body)
 *
 * Every block starts at the beginning of a line with ATTACHMENT_MARKER, and a
 * notice line ends with "]".
 */

export const ATTACHMENT_MARKER = '[Attached file: ';

export interface IFencedBlockInput {
  name: string;
  id?: string;
  /** Short sentence appended to the header line, e.g. the preview hint. */
  hint?: string;
  body: string;
}

export interface INoticeBlockInput {
  name: string;
  id?: string;
  mimeType: string;
  size: number;
}

export interface ISplitAttachmentBlocks {
  /** What the person typed — the message without its attachment blocks. */
  text: string;
  /** The full string the model received. Absent when nothing was split. */
  agentText?: string;
}

function header(name: string, id?: string): string {
  return id
    ? `${ATTACHMENT_MARKER}${name} — id: ${id}]`
    : `${ATTACHMENT_MARKER}${name}]`;
}

/** A fence wider than any run of backticks that opens a line in the body. */
function chooseFence(body: string): string {
  let longest = 0;
  for (const line of body.split('\n')) {
    const m = /^`{3,}/.exec(line);
    if (m && m[0].length > longest) longest = m[0].length;
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

/** Fenced block for inlined contents (text kinds, PDF, DOCX, spreadsheets). */
export function fencedBlock(input: IFencedBlockInput): string {
  const fence = chooseFence(input.body);
  const head = input.hint
    ? `${header(input.name, input.id)} — ${input.hint}`
    : header(input.name, input.id);
  return `${head}\n${fence}\n${input.body}\n${fence}`;
}

/**
 * What the model is told about a binary it cannot read: name, type, size —
 * and that the contents are out of reach, so it answers honestly instead of
 * denying the file exists.
 */
export function noticeBlock(input: INoticeBlockInput): string {
  const head = input.id
    ? `${ATTACHMENT_MARKER}${input.name} — id: ${input.id}`
    : `${ATTACHMENT_MARKER}${input.name}`;
  return (
    `${head} (${input.mimeType}, ${input.size.toLocaleString('en-US')} bytes). ` +
    `Its contents are not readable in this chat — it is delivered as a ` +
    `named reference only.]`
  );
}

/**
 * Mirrors the runtime's own wording for truncated over-long user messages,
 * so the model meets one convention rather than two.
 */
export function truncationNotice(removed: number, limit: number): string {
  return (
    `[… ${removed.toLocaleString('en-US')} characters truncated — ` +
    `attached file was longer than the ` +
    `${limit.toLocaleString('en-US')}-character limit …]`
  );
}

const FENCE_LINE = /^`{3,}$/;

/**
 * Take the attachment blocks off a persisted user message.
 *
 * Conservative by design: the section from the first marker line to the end
 * must parse as nothing but valid blocks, otherwise the text is returned
 * untouched. A parse failure never drops content — a bubble that is too long
 * is a nuisance, a bubble missing what the person wrote is data loss.
 */
export function splitAttachmentBlocks(text: string): ISplitAttachmentBlocks {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.startsWith(ATTACHMENT_MARKER));
  if (first === -1) return { text };

  let pos = first;
  const n = lines.length;
  for (;;) {
    const line = lines[pos];
    if (!line.startsWith(ATTACHMENT_MARKER)) return { text };

    if (pos + 1 < n && FENCE_LINE.test(lines[pos + 1])) {
      const fence = lines[pos + 1];
      let close = -1;
      for (let j = pos + 2; j < n; j++) {
        if (lines[j] === fence) {
          close = j;
          break;
        }
      }
      if (close === -1) return { text };
      pos = close + 1;
    } else if (line.endsWith(']')) {
      pos += 1;
    } else {
      return { text };
    }

    if (pos >= n) break;
    if (lines[pos] !== '') return { text };
    while (pos < n && lines[pos] === '') pos++;
    if (pos >= n) break;
  }

  const typed = lines.slice(0, first).join('\n').trimEnd();
  return { text: typed, agentText: text };
}
