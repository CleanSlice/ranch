import {
  ATTACHMENT_MARKER,
  fencedBlock,
  noticeBlock,
  splitAttachmentBlocks,
  truncationNotice,
} from './attachmentBlocks';

const ID = '0b53c9a4-7f4e-4bb1-a6b1-6a1f2f9c8f21';

describe('attachment block builders', () => {
  it('writes a fenced block whose header carries the name and id', () => {
    const block = fencedBlock({ name: 'notes.md', id: ID, body: 'hello' });
    expect(block).toBe(
      `[Attached file: notes.md — id: ${ID}]\n\`\`\`\nhello\n\`\`\``,
    );
  });

  it('appends the hint to the header line when given', () => {
    const block = fencedBlock({
      name: 'x.xlsx',
      id: ID,
      hint: 'this is a preview',
      body: 'b',
    });
    expect(block.split('\n')[0]).toBe(
      `[Attached file: x.xlsx — id: ${ID}] — this is a preview`,
    );
  });

  it('widens the fence when the body contains a backtick fence line', () => {
    const body = 'a\n```\nb\n```';
    const block = fencedBlock({ name: 'f.md', id: ID, body });
    const lines = block.split('\n');
    expect(lines[1]).toBe('````');
    expect(lines[lines.length - 1]).toBe('````');
  });

  it('writes a one-line notice with type and size', () => {
    const line = noticeBlock({
      name: 'deck.pptx',
      id: ID,
      mimeType: 'application/vnd.ms-powerpoint',
      size: 1234,
    });
    expect(line.startsWith(ATTACHMENT_MARKER)).toBe(true);
    expect(line).toContain(
      `deck.pptx — id: ${ID} (application/vnd.ms-powerpoint, 1,234 bytes)`,
    );
    expect(line.endsWith(']')).toBe(true);
    expect(line).not.toContain('\n');
  });

  it('formats the truncation notice with the runtime wording', () => {
    expect(truncationNotice(500, 100_000)).toBe(
      '[… 500 characters truncated — attached file was longer than the 100,000-character limit …]',
    );
  });
});

describe('splitAttachmentBlocks', () => {
  it('leaves a message without blocks untouched', () => {
    expect(splitAttachmentBlocks('just text')).toEqual({ text: 'just text' });
  });

  it('splits typed text from a new-format fenced block', () => {
    const block = fencedBlock({ name: 'a.txt', id: ID, body: 'contents' });
    const full = `распарси\n\n${block}`;
    expect(splitAttachmentBlocks(full)).toEqual({
      text: 'распарси',
      agentText: full,
    });
  });

  it('splits a legacy fenced block written before ids existed', () => {
    const full = 'hi\n\n[Attached file: a.txt]\n```\ncontents\n```';
    expect(splitAttachmentBlocks(full)).toEqual({
      text: 'hi',
      agentText: full,
    });
  });

  it('splits a legacy notice line', () => {
    const full =
      'hi\n\n[Attached file: deck.pptx (application/vnd.ms-powerpoint, 1,234 bytes). ' +
      'Its contents are not readable in this chat — it is delivered as a named reference only.]';
    expect(splitAttachmentBlocks(full)).toEqual({
      text: 'hi',
      agentText: full,
    });
  });

  it('splits a new notice line', () => {
    const line = noticeBlock({
      name: 'deck.pptx',
      id: ID,
      mimeType: 'application/vnd.ms-powerpoint',
      size: 1234,
    });
    const full = `hi\n\n${line}`;
    expect(splitAttachmentBlocks(full)).toEqual({
      text: 'hi',
      agentText: full,
    });
  });

  it('returns an empty text for an attachment-only message', () => {
    const full = fencedBlock({ name: 'a.txt', id: ID, body: 'x' });
    expect(splitAttachmentBlocks(full)).toEqual({ text: '', agentText: full });
  });

  it('handles several blocks of mixed shape after the typed text', () => {
    const b1 = fencedBlock({ name: 'a.txt', id: ID, body: 'one' });
    const b2 = noticeBlock({
      name: 'b.ppt',
      id: ID,
      mimeType: 'application/vnd.ms-powerpoint',
      size: 9,
    });
    const b3 = fencedBlock({
      name: 'c.xlsx',
      id: ID,
      hint: 'this is a preview',
      body: 'R1: A=1',
    });
    const full = `see files\n\n${b1}\n\n${b2}\n\n${b3}`;
    expect(splitAttachmentBlocks(full)).toEqual({
      text: 'see files',
      agentText: full,
    });
  });

  it('keeps a block whose body contains a widened fence', () => {
    const body = 'a\n```\nb\n```';
    const full = `t\n\n${fencedBlock({ name: 'f.md', id: ID, body })}`;
    expect(splitAttachmentBlocks(full)).toEqual({ text: 't', agentText: full });
  });

  it('keeps a block that ends with a truncation notice inside the fence', () => {
    const body = `abc\n\n${truncationNotice(10, 3)}`;
    const full = `t\n\n${fencedBlock({ name: 'f.md', id: ID, body })}`;
    expect(splitAttachmentBlocks(full)).toEqual({ text: 't', agentText: full });
  });

  it('does not split when the marker line is not followed by a valid block', () => {
    const full =
      'note to self:\n[Attached file: x] is what the API says\nmore text';
    expect(splitAttachmentBlocks(full)).toEqual({ text: full });
  });

  it('does not split when the closing fence is missing (truncated line)', () => {
    const full = 'hi\n\n[Attached file: a.txt — id: x]\n```\ncontents';
    expect(splitAttachmentBlocks(full)).toEqual({ text: full });
  });

  it('does not split when text follows the last block', () => {
    const block = fencedBlock({ name: 'a.txt', id: ID, body: 'x' });
    const full = `hi\n\n${block}\n\ntrailing prose`;
    expect(splitAttachmentBlocks(full)).toEqual({ text: full });
  });

  it('tolerates trailing blank lines after the last block', () => {
    const block = fencedBlock({ name: 'a.txt', id: ID, body: 'x' });
    const full = `hi\n\n${block}\n\n`;
    expect(splitAttachmentBlocks(full)).toEqual({
      text: 'hi',
      agentText: full,
    });
  });
});
