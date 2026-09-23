import { BadRequestException } from '@nestjs/common';

/** `JSON.parse` with a "line L col C" message the editor can show. */
export function assertJson(content: string): void {
  try {
    JSON.parse(content);
  } catch (err) {
    const msg = (err as Error).message;
    const at = jsonErrorPosition(content, msg);
    if (at) {
      throw new BadRequestException(
        `invalid JSON at line ${at.line} col ${at.col}: ${msg}`,
      );
    }
    throw new BadRequestException(`invalid JSON: ${msg}`);
  }
}

/**
 * V8 has had three message shapes: `… at position N`, `… (line L column C)`
 * and `Unexpected token 'x', "…<context>" is not valid JSON` where the
 * context ends at the offending token. All three are turned into line/col.
 */
export function jsonErrorPosition(
  content: string,
  message: string,
): { line: number; col: number } | null {
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) return { line: Number(lineCol[1]), col: Number(lineCol[2]) };

  let pos: number | null = null;
  const position = /position (\d+)/.exec(message);
  if (position) {
    pos = Number(position[1]);
  } else {
    const ctx = /, (?:\.\.\.)?"([\s\S]*?)"(?:\.\.\.)? is not valid JSON$/.exec(
      message,
    );
    if (ctx) {
      const snippet = ctx[1];
      const idx = snippet ? content.indexOf(snippet) : -1;
      if (idx >= 0) pos = idx + Math.max(0, snippet.length - 1);
    }
  }
  if (pos === null) return null;
  const before = content.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return { line, col };
}
