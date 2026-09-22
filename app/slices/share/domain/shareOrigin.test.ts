import { describe, expect, test } from 'bun:test';
import {
  buildShareUrl,
  resolveShareOrigin,
  SHARE_ORIGIN_RULES,
  type IShareOriginRule,
} from './shareOrigin';

const MAZDA_DEV = 'https://dev-mazda-ai.mycoso.cloud';
const MAZDA_PROD = 'https://mazda-ai.mycoso.cloud';

describe('resolveShareOrigin', () => {
  test('leaves an ordinary origin alone', () => {
    // The case every existing installation is in: no configured base, no
    // matching rule, behaviour identical to before this existed.
    expect(resolveShareOrigin('https://ranch.cleanslice.org')).toBe(
      'https://ranch.cleanslice.org',
    );
  });

  test('a configured base wins over everything', () => {
    expect(
      resolveShareOrigin(MAZDA_DEV, 'https://somewhere.else.example'),
    ).toBe('https://somewhere.else.example');
  });

  test('a configured base is used even where a rule would also match', () => {
    // Deployment config is the mechanism; the table is the fallback.
    expect(resolveShareOrigin(MAZDA_DEV, 'https://pinned.example')).toBe(
      'https://pinned.example',
    );
  });

  test('a blank or whitespace base falls through rather than winning', () => {
    expect(resolveShareOrigin(MAZDA_DEV, '')).toBe(
      'https://ranch.dev-mazda-ai.mycoso.cloud',
    );
    expect(resolveShareOrigin(MAZDA_DEV, '   ')).toBe(
      'https://ranch.dev-mazda-ai.mycoso.cloud',
    );
    expect(resolveShareOrigin(MAZDA_DEV, null)).toBe(
      'https://ranch.dev-mazda-ai.mycoso.cloud',
    );
  });

  test('trailing slashes never reach the link', () => {
    expect(resolveShareOrigin(MAZDA_DEV, 'https://pinned.example/')).toBe(
      'https://pinned.example',
    );
    expect(resolveShareOrigin('https://ranch.cleanslice.org/')).toBe(
      'https://ranch.cleanslice.org',
    );
  });
});

describe('the shipped rules', () => {
  test("adds Mazda's public label on the dev host", () => {
    expect(resolveShareOrigin(MAZDA_DEV)).toBe(
      'https://ranch.dev-mazda-ai.mycoso.cloud',
    );
  });

  test('and on production', () => {
    expect(resolveShareOrigin(MAZDA_PROD)).toBe(
      'https://ranch.mazda-ai.mycoso.cloud',
    );
  });

  test('leaves the already-correct public host untouched', () => {
    // Opening the console on the published address must not add a second
    // label and produce ranch.ranch.…
    expect(resolveShareOrigin('https://ranch.dev-mazda-ai.mycoso.cloud')).toBe(
      'https://ranch.dev-mazda-ai.mycoso.cloud',
    );
  });

  test('does not rewrite a neighbouring host that merely looks similar', () => {
    expect(resolveShareOrigin('https://other.mycoso.cloud')).toBe(
      'https://other.mycoso.cloud',
    );
    expect(resolveShareOrigin('https://mazda-ai.example.com')).toBe(
      'https://mazda-ai.example.com',
    );
  });

  test('keeps the scheme it was given instead of forcing https', () => {
    expect(resolveShareOrigin('http://mazda-ai.mycoso.cloud')).toBe(
      'http://ranch.mazda-ai.mycoso.cloud',
    );
  });

  test('every shipped rule is anchored, so it cannot match a suffix', () => {
    // An unanchored rule would rewrite evil-dev-mazda-ai.mycoso.cloud too.
    for (const rule of SHARE_ORIGIN_RULES) {
      expect(rule.match.source.startsWith('^')).toBe(true);
      expect(rule.match.source.endsWith('$')).toBe(true);
    }
  });

  test('no shipped rule carries the global flag', () => {
    // A /g regex keeps lastIndex between .test() calls and would match only
    // every other time it is consulted.
    for (const rule of SHARE_ORIGIN_RULES) {
      expect(rule.match.global).toBe(false);
    }
  });
});

describe('rule ordering', () => {
  test('the first match wins', () => {
    const rules: IShareOriginRule[] = [
      { match: /^(https:\/\/)(a\.example)$/, publicOrigin: '$1first.$2' },
      { match: /^(https:\/\/)(a\.example)$/, publicOrigin: '$1second.$2' },
    ];
    expect(resolveShareOrigin('https://a.example', null, rules)).toBe(
      'https://first.a.example',
    );
  });
});

describe('buildShareUrl', () => {
  test('puts the token on the public origin', () => {
    expect(buildShareUrl(MAZDA_DEV, 'sl_XXX')).toBe(
      'https://ranch.dev-mazda-ai.mycoso.cloud/share?token=sl_XXX',
    );
  });

  test('uses the configured base when there is one', () => {
    expect(buildShareUrl(MAZDA_DEV, 'sl_XXX', 'https://pinned.example')).toBe(
      'https://pinned.example/share?token=sl_XXX',
    );
  });
});
