import { describe, expect, test } from 'bun:test';
import { draftFromQuery, MAX_LINK_DRAFT_LENGTH, withLinkDraft, withoutDraft } from './draftLink';

// CLEAN-243: the extension opens the chat with what to tell the agent in the box.
describe('draft links', () => {
  test('reads the message a link carries', () => {
    expect(draftFromQuery({ draft: 'Open shadow with profile "shadow".' })).toBe('Open shadow with profile "shadow".');
    expect(draftFromQuery({ draft: ['first', 'second'] })).toBe('first');
  });

  test('no message, an empty one or a non-string one is none', () => {
    expect(draftFromQuery({})).toBe(null);
    expect(draftFromQuery({ draft: '   ' })).toBe(null);
    expect(draftFromQuery({ draft: null })).toBe(null);
  });

  test('drops hidden characters and caps the length', () => {
    expect(draftFromQuery({ draft: 'a\u0000b\u001bc\nd\te' })).toBe('abc\nd\te');
    expect(draftFromQuery({ draft: 'x'.repeat(5000) })?.length).toBe(MAX_LINK_DRAFT_LENGTH);
  });

  test('the address loses the message and keeps the rest', () => {
    expect(withoutDraft({ draft: 'hi', tab: 'chat' })).toEqual({ tab: 'chat' });
  });

  test('joins what was typed instead of replacing it', () => {
    expect(withLinkDraft('', 'hello')).toBe('hello');
    expect(withLinkDraft('typed  ', 'hello')).toBe('typed\n\nhello');
  });
});
