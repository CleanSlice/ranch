import { describe, expect, test } from 'bun:test';
import { buildShareUrl, resolveAppOrigin } from './shareUrl';

describe('resolveAppOrigin', () => {
  test('uses the configured app url over anything it could guess', () => {
    expect(
      resolveAppOrigin('https://ranch.example.com', 'http://localhost:3001'),
    ).toBe('https://ranch.example.com');
  });

  test('drops trailing slashes and surrounding whitespace', () => {
    expect(resolveAppOrigin(' https://ranch.example.com// ', null)).toBe(
      'https://ranch.example.com',
    );
  });

  test('keeps a sub-path the app is served under', () => {
    expect(resolveAppOrigin('https://example.com/console/', null)).toBe(
      'https://example.com/console',
    );
  });

  test('falls back to the dev app port when admin runs locally', () => {
    expect(resolveAppOrigin('', 'http://localhost:3001')).toBe(
      'http://localhost:3000',
    );
    expect(resolveAppOrigin(undefined, 'http://127.0.0.1:3001')).toBe(
      'http://127.0.0.1:3000',
    );
  });

  test('derives the app from admin.<domain> with nothing configured', () => {
    expect(resolveAppOrigin('', 'https://admin.ranch.example.com')).toBe(
      'https://ranch.example.com',
    );
    expect(resolveAppOrigin(undefined, 'https://admin.example.com:8443')).toBe(
      'https://example.com:8443',
    );
  });

  test('does not guess when admin is not on an admin.<domain> host', () => {
    expect(resolveAppOrigin('', 'https://console.example.com')).toBe(null);
    expect(resolveAppOrigin('', 'https://admin.com')).toBe(null);
  });

  test('ignores a configured value that is not an http(s) url', () => {
    expect(
      resolveAppOrigin('ranch.example.com', 'https://console.example.com'),
    ).toBe(null);
    // …and an unusable override falls through to the address rule, it does
    // not switch the rule off.
    expect(
      resolveAppOrigin('javascript:alert(1)', 'https://admin.example.com'),
    ).toBe('https://example.com');
  });
});

describe('buildShareUrl', () => {
  test('points at the app share page', () => {
    expect(buildShareUrl('https://ranch.example.com', 'abc-123_x')).toBe(
      'https://ranch.example.com/share?token=abc-123_x',
    );
  });

  test('escapes a token that is not url-safe', () => {
    expect(buildShareUrl('http://localhost:3000', 'a+b/c=')).toBe(
      'http://localhost:3000/share?token=a%2Bb%2Fc%3D',
    );
  });
});
