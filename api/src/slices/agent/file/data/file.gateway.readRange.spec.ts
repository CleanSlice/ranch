import { assertJson, contentTypeFor, sliceChunk } from './file.gateway';

// Pure helpers of the S3 gateway (CLEAN-112). The S3 round trips themselves
// are not unit-tested here; what matters is that a slice never ends in the
// middle of a character and that JSON errors carry a position.

describe('sliceChunk', () => {
  const euro = Buffer.from('€'); // e2 82 ac
  const smile = Buffer.from('😀'); // f0 9f 98 80

  it('passes ASCII through untouched', () => {
    const raw = Buffer.from('hello');
    expect(sliceChunk(raw, 0, 100)).toEqual({
      content: 'hello',
      size: 5,
      offset: 0,
      nextOffset: 5,
      hasMore: true,
    });
  });

  it('hands a dangling 3-byte sequence back to the next request', () => {
    const raw = Buffer.concat([Buffer.from('ab'), euro.subarray(0, 2)]);
    const chunk = sliceChunk(raw, 0, 100);
    expect(chunk.content).toBe('ab');
    expect(chunk.size).toBe(2);
    expect(chunk.nextOffset).toBe(2);
    expect(chunk.hasMore).toBe(true);
  });

  it('hands back one, two or three bytes of a 4-byte sequence', () => {
    for (const cut of [1, 2, 3]) {
      const raw = Buffer.concat([Buffer.from('x'), smile.subarray(0, cut)]);
      const chunk = sliceChunk(raw, 10, 1000);
      expect(chunk.content).toBe('x');
      expect(chunk.nextOffset).toBe(11);
    }
  });

  it('keeps a complete sequence at the boundary', () => {
    const raw = Buffer.concat([Buffer.from('x'), euro]);
    const chunk = sliceChunk(raw, 0, 100);
    expect(chunk.content).toBe('x€');
    expect(chunk.size).toBe(4);
    expect(chunk.nextOffset).toBe(4);
  });

  it('never trims at the end of the object', () => {
    const raw = Buffer.concat([Buffer.from('x'), euro.subarray(0, 1)]);
    const chunk = sliceChunk(raw, 0, 2);
    expect(chunk.size).toBe(2);
    expect(chunk.hasMore).toBe(false);
    expect(chunk.nextOffset).toBeNull();
  });

  it('reports the end of file', () => {
    const chunk = sliceChunk(Buffer.from('tail'), 96, 100);
    expect(chunk.hasMore).toBe(false);
    expect(chunk.nextOffset).toBeNull();
  });
});

describe('assertJson', () => {
  it('accepts valid JSON', () => {
    expect(() => assertJson('{"a": 1}')).not.toThrow();
  });

  it('reports a line and column', () => {
    expect(() => assertJson('{\n  "a": 1,\n  "b": \n}')).toThrow(
      /invalid JSON at line \d+ col \d+/,
    );
  });
});

describe('contentTypeFor', () => {
  it('maps recognised extensions', () => {
    expect(contentTypeFor('a.json')).toBe('application/json; charset=utf-8');
    expect(contentTypeFor('SOUL.md')).toBe('text/markdown; charset=utf-8');
    expect(contentTypeFor('data/x.yaml')).toBe(
      'application/yaml; charset=utf-8',
    );
    expect(contentTypeFor('img.png')).toBe('image/png');
  });

  it('falls back to text for text kinds and octet-stream for binary', () => {
    expect(contentTypeFor('run.ts')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('Makefile')).toBe('text/plain; charset=utf-8');
    expect(contentTypeFor('font.woff2')).toBe('application/octet-stream');
  });
});
