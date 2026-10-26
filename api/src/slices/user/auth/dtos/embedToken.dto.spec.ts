import { validate } from 'class-validator';
import { EmbedTokenDto } from './embedToken.dto';

/**
 * `sub` becomes the chat client id, the transcript channel and part of the
 * session file name `data/sessions/bridle:<sub>.jsonl` on the runtime
 * (CLEAN-175). Only key holders can mint, so this is defence in depth: a
 * typo or a leaked key must not land a visitor in the admin conversation,
 * in a namespace the hub mints itself, or outside the sessions folder.
 */

async function subErrors(sub: unknown): Promise<string[]> {
  const dto = Object.assign(new EmbedTokenDto(), { sub });
  const errors = await validate(dto);
  return errors
    .filter((e) => e.property === 'sub')
    .flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('EmbedTokenDto.sub', () => {
  it.each([
    'wslid-A1234567',
    'user_42',
    'A',
    'x'.repeat(128),
    // The reserved words are only reserved as a whole or as a prefix.
    'administrator',
    'anonymous',
  ])('accepts %p', async (sub) => {
    expect(await subErrors(sub)).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['too long', 'x'.repeat(129)],
    ['the admin conversation', 'admin'],
    ['the anonymous namespace', 'anon-1'],
    ['the share namespace', 'share-x'],
    ['the http fallback namespace', 'http-y'],
    ['a path segment up', '../x'],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['the agent service namespace', 'agent:x'],
    ['whitespace', 'a b'],
    ['not a string', 42],
  ])('refuses %s', async (_label, sub) => {
    expect((await subErrors(sub)).length).toBeGreaterThan(0);
  });
});
