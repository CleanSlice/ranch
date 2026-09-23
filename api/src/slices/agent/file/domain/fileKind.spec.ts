import {
  extensionOf,
  isEditable,
  kindFromPath,
  sniffKind,
  trailingPartialUtf8,
} from './fileKind';
import { MAX_EDIT_BYTES } from './file.limits';

describe('kindFromPath', () => {
  it('recognises the text formats a template or an agent writes', () => {
    for (const p of [
      'SOUL.md',
      'agent.config.json',
      'skills/run.py',
      'data/config.yaml',
      'workspace/log.txt',
      'scripts/build.sh',
      'memory/2026-09-21.MD',
      'data/.env',
    ]) {
      expect(kindFromPath(p)).toBe('text');
    }
  });

  it('recognises binary formats without sniffing', () => {
    for (const p of ['data/photo.png', 'workspace/report.pdf', 'x.zip']) {
      expect(kindFromPath(p)).toBe('binary');
    }
  });

  it('leaves extension-less and unknown extensions to the sniff', () => {
    expect(kindFromPath('Makefile')).toBe('unknown');
    expect(kindFromPath('skills/tool.wasm')).toBe('unknown');
    expect(kindFromPath('data/notes.unknownext')).toBe('unknown');
  });

  it('takes the extension from the file name, not from a folder', () => {
    expect(extensionOf('skills.d/README')).toBe('');
    expect(extensionOf('a/b.c/d.TXT')).toBe('.txt');
  });
});

describe('sniffKind', () => {
  it('calls a NUL byte binary', () => {
    expect(sniffKind(Buffer.from([0x68, 0x69, 0x00, 0x21]))).toBe('binary');
  });

  it('calls invalid UTF-8 binary', () => {
    expect(sniffKind(Buffer.from([0xff, 0xfe, 0x41, 0x42]))).toBe('binary');
  });

  it('calls plain ASCII and valid UTF-8 text', () => {
    expect(sniffKind(Buffer.from('all: build\n\tbun run build\n'))).toBe('text');
    expect(sniffKind(Buffer.from('привет — ok'))).toBe('text');
  });

  it('tolerates a head cut in the middle of a multi-byte character', () => {
    const full = Buffer.from('ab€cd'); // € is 3 bytes
    const cut = full.subarray(0, 3); // 'a','b', first byte of €
    expect(sniffKind(cut)).toBe('text');
  });

  it('treats an empty file as text', () => {
    expect(sniffKind(Buffer.alloc(0))).toBe('text');
  });
});

describe('trailingPartialUtf8', () => {
  const euro = Buffer.from('€'); // e2 82 ac
  const smile = Buffer.from('😀'); // f0 9f 98 80
  const eacute = Buffer.from('é'); // c3 a9

  it('returns 0 for ASCII and for complete sequences', () => {
    expect(trailingPartialUtf8(Buffer.from('abc'))).toBe(0);
    expect(trailingPartialUtf8(Buffer.concat([Buffer.from('a'), euro]))).toBe(0);
    expect(trailingPartialUtf8(smile)).toBe(0);
  });

  it('counts the dangling bytes of a 2-byte sequence', () => {
    expect(trailingPartialUtf8(Buffer.concat([Buffer.from('a'), eacute.subarray(0, 1)]))).toBe(1);
  });

  it('counts the dangling bytes of a 3-byte sequence at each cut', () => {
    expect(trailingPartialUtf8(euro.subarray(0, 1))).toBe(1);
    expect(trailingPartialUtf8(euro.subarray(0, 2))).toBe(2);
  });

  it('counts the dangling bytes of a 4-byte sequence at each cut', () => {
    expect(trailingPartialUtf8(smile.subarray(0, 1))).toBe(1);
    expect(trailingPartialUtf8(smile.subarray(0, 2))).toBe(2);
    expect(trailingPartialUtf8(smile.subarray(0, 3))).toBe(3);
  });

  it('returns 0 for an empty buffer', () => {
    expect(trailingPartialUtf8(Buffer.alloc(0))).toBe(0);
  });
});

describe('isEditable', () => {
  it('is text within the edit cap', () => {
    expect(isEditable('text', 10)).toBe(true);
    expect(isEditable('text', MAX_EDIT_BYTES)).toBe(true);
    expect(isEditable('text', MAX_EDIT_BYTES + 1)).toBe(false);
    expect(isEditable('binary', 10)).toBe(false);
  });
});
