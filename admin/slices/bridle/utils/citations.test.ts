import { describe, expect, test } from 'bun:test';
import { markCitations, stripCitations } from './citations';

describe('markCitations', () => {
  test('a numbered chip for every marker outside code', () => {
    expect(markCitations('Fact A. [^1] Fact B. [^2]', 'numbered')).toBe(
      'Fact A. <sup class="chat-cite" data-n="1" role="button" tabindex="0">1</sup> ' +
        'Fact B. <sup class="chat-cite" data-n="2" role="button" tabindex="0">2</sup>',
    );
  });

  test('a neutral dot while the answer is still streaming', () => {
    const out = markCitations('Fact. [^7]', 'pending');
    expect(out).toContain('chat-cite--pending');
    expect(out).not.toContain('7</sup>');
    expect(out).not.toContain('[^7]');
  });

  test('leaves markers inside fenced and inline code exactly as written', () => {
    const md = 'Use `[^1]` literally.\n\n```md\nSee [^2] here\n```\nReal one. [^3]';
    const out = markCitations(md, 'numbered');
    expect(out).toContain('`[^1]`');
    expect(out).toContain('See [^2] here');
    expect(out).toContain('data-n="3"');
  });

  test('ignores things that only look like a marker', () => {
    expect(markCitations('[^abc] and [^1234] and [1]', 'numbered')).toBe(
      '[^abc] and [^1234] and [1]',
    );
  });

  test('returns the input untouched when there is nothing to do', () => {
    expect(markCitations('plain', 'numbered')).toBe('plain');
    expect(markCitations('', 'numbered')).toBe('');
  });
});

describe('stripCitations', () => {
  test('removes the marker and the space before it, outside code', () => {
    expect(stripCitations('Fact A. [^1] Fact B.[^2]')).toBe('Fact A. Fact B.');
    expect(stripCitations('keep `[^1]`')).toBe('keep `[^1]`');
  });
});
