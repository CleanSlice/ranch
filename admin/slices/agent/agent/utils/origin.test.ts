import { describe, expect, test } from 'bun:test';
import { parseOrigin } from './origin';

const origin = (text: string) => {
  const parsed = parseOrigin(text);
  return parsed.ok ? parsed.origin : null;
};

describe('parseOrigin', () => {
  test('scheme and host', () => {
    expect(origin('https://example.com')).toBe('https://example.com');
    expect(origin('http://localhost')).toBe('http://localhost');
    expect(origin('https://shop.example.co.uk')).toBe('https://shop.example.co.uk');
  });

  test('an optional port', () => {
    expect(origin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(origin('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(origin('http://[::1]:3000')).toBe('http://[::1]:3000');
  });

  test('is trimmed, and a trailing slash is stripped', () => {
    expect(origin('  https://example.com  ')).toBe('https://example.com');
    expect(origin('https://example.com/')).toBe('https://example.com');
    expect(origin('https://example.com///')).toBe('https://example.com');
  });

  test('one form for scheme and host', () => {
    expect(origin('HTTPS://Example.COM')).toBe('https://example.com');
  });

  test('a path, a query or a fragment is refused', () => {
    expect(parseOrigin('https://example.com/chat')).toEqual({ ok: false });
    expect(parseOrigin('https://example.com/chat/')).toEqual({ ok: false });
    expect(parseOrigin('https://example.com?x=1')).toEqual({ ok: false });
    expect(parseOrigin('https://example.com#top')).toEqual({ ok: false });
  });

  test('a missing or foreign scheme is refused', () => {
    expect(parseOrigin('example.com')).toEqual({ ok: false });
    expect(parseOrigin('//example.com')).toEqual({ ok: false });
    expect(parseOrigin('ftp://example.com')).toEqual({ ok: false });
    expect(parseOrigin('https://')).toEqual({ ok: false });
  });

  test('a space is refused', () => {
    expect(parseOrigin('https://exa mple.com')).toEqual({ ok: false });
    expect(parseOrigin('https://a.test https://b.test')).toEqual({ ok: false });
  });

  test('a wildcard is refused', () => {
    expect(parseOrigin('*')).toEqual({ ok: false });
    expect(parseOrigin('https://*.example.com')).toEqual({ ok: false });
    expect(parseOrigin('https://*')).toEqual({ ok: false });
  });

  test('a port that is not one is refused', () => {
    expect(parseOrigin('http://localhost:')).toEqual({ ok: false });
    expect(parseOrigin('http://localhost:0')).toEqual({ ok: false });
    expect(parseOrigin('http://localhost:99999')).toEqual({ ok: false });
    expect(parseOrigin('http://localhost:abc')).toEqual({ ok: false });
  });

  test('nothing typed is refused', () => {
    expect(parseOrigin('')).toEqual({ ok: false });
    expect(parseOrigin('   ')).toEqual({ ok: false });
    expect(parseOrigin('/')).toEqual({ ok: false });
  });
});
