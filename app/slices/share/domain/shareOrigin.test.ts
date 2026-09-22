import { describe, expect, test } from 'bun:test';
import { buildShareUrl, resolveAppOrigin } from './shareOrigin';

const OWN = 'https://dev-mazda-ai.mycoso.cloud';
const PUBLISHED = 'https://ranch.dev-mazda-ai.mycoso.cloud';

describe('resolveAppOrigin', () => {
  test('falls back to the address bar, which is right almost everywhere', () => {
    expect(resolveAppOrigin('', 'https://ranch.cleanslice.org')).toBe(
      'https://ranch.cleanslice.org',
    );
  });

  test('a configured address wins over the address bar', () => {
    // The Mazda case: the console answers on one host and is published under
    // another, so the bar is not the address to hand out (CLEAN-110).
    expect(resolveAppOrigin(PUBLISHED, OWN)).toBe(PUBLISHED);
  });

  test('blank, whitespace and null all fall through', () => {
    expect(resolveAppOrigin('', OWN)).toBe(OWN);
    expect(resolveAppOrigin('   ', OWN)).toBe(OWN);
    expect(resolveAppOrigin(null, OWN)).toBe(OWN);
    expect(resolveAppOrigin(undefined, OWN)).toBe(OWN);
  });

  test('a junk configured value falls through rather than breaking the link', () => {
    expect(resolveAppOrigin('not a url', OWN)).toBe(OWN);
    expect(resolveAppOrigin('javascript:alert(1)', OWN)).toBe(OWN);
    expect(resolveAppOrigin('ftp://files.example', OWN)).toBe(OWN);
  });

  test('keeps a sub-path when the app is served under one', () => {
    expect(resolveAppOrigin('https://example.org/ranch', OWN)).toBe(
      'https://example.org/ranch',
    );
  });

  test('never leaves a trailing slash for the caller to double up', () => {
    expect(resolveAppOrigin('https://example.org/', OWN)).toBe(
      'https://example.org',
    );
    expect(resolveAppOrigin('', 'https://example.org/')).toBe(
      'https://example.org',
    );
  });

  test('is null only when there is nothing at all to build from', () => {
    // SSR: no address bar, nothing configured.
    expect(resolveAppOrigin(null, null)).toBe(null);
  });
});

describe('buildShareUrl', () => {
  test('puts the token on the resolved origin', () => {
    expect(buildShareUrl(PUBLISHED, 'sl_XXX')).toBe(
      `${PUBLISHED}/share?token=sl_XXX`,
    );
  });

  test('encodes the token, matching the admin console exactly', () => {
    // The two consoles disagreed on this until CLEAN-111: admin encoded, app
    // did not. A token that works from one console and not the other is the
    // worst kind of bug to be told about.
    expect(buildShareUrl('https://example.org', 'a b&c=d')).toBe(
      'https://example.org/share?token=a%20b%26c%3Dd',
    );
  });
});
