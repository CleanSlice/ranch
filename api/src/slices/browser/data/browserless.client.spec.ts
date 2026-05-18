import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BrowserlessClient } from './browserless.client';

// ConfigService stub — returns whatever the test puts in `values`, falls back
// to the default the production code provides. Keeps the test focused on what
// `BrowserlessClient` does with config, not on Nest's config plumbing.
function makeConfig(
  values: Record<string, string | undefined> = {},
): ConfigService {
  return {
    get: <T>(key: string, defaultValue?: T) =>
      (values[key] ?? defaultValue ?? undefined) as T,
  } as unknown as ConfigService;
}

// JwtService has ~9 methods; BrowserlessClient only ever calls .sign(). The
// cast happens here so call sites stay readable, and the intersection with
// `{ sign: jest.Mock }` lets test code call `.mockClear()` / inspect the spy
// without re-casting on every line.
type JwtServiceMock = JwtService & { sign: jest.Mock };

function makeJwt(): JwtServiceMock {
  return {
    sign: jest.fn(() => 'signed.jwt.value'),
  } as unknown as JwtServiceMock;
}

describe('BrowserlessClient', () => {
  describe('profilePath', () => {
    it('joins userId and slugified accountKey under /profiles/', () => {
      const client = new BrowserlessClient(
        makeConfig({ BROWSER_POOL_TOKEN: 'tok' }),
        makeJwt(),
      );
      expect(client.profilePath('user-42', 'instagram:miybot')).toBe(
        '/profiles/user-42/instagram:miybot',
      );
    });

    it('lowercases and replaces every unsafe character with a dash', () => {
      const client = new BrowserlessClient(
        makeConfig({ BROWSER_POOL_TOKEN: 'tok' }),
        makeJwt(),
      );
      // Spaces, slashes, dots — every char outside [a-z0-9_:-] is replaced
      // one-for-one with a dash. We intentionally don't collapse runs so the
      // slug remains deterministic for a given input (a future change that
      // collapses dashes could collide two different account labels onto
      // the same profile path).
      expect(client.profilePath('u', 'Instagram /  miy.bot')).toBe(
        '/profiles/u/instagram----miy-bot',
      );
    });

    it('rejects path-traversal attempts in accountKey via slug normalisation', () => {
      const client = new BrowserlessClient(
        makeConfig({ BROWSER_POOL_TOKEN: 'tok' }),
        makeJwt(),
      );
      // `../../etc/passwd` slugified loses slashes/dots → safe segment.
      // The leading/trailing dashes get trimmed, so no traversal in either
      // direction even if a future bug forgot to prefix-check.
      const path = client.profilePath('u', '../../etc/passwd');
      expect(path).toBe('/profiles/u/etc-passwd');
      expect(path).not.toContain('..');
    });

    it('throws when accountKey slugifies to empty (refuses to build half-path)', () => {
      const client = new BrowserlessClient(
        makeConfig({ BROWSER_POOL_TOKEN: 'tok' }),
        makeJwt(),
      );
      expect(() => client.profilePath('u', '!!!')).toThrow(
        /Refusing to build profile path with empty segments/,
      );
    });

    it('throws when userId is empty', () => {
      const client = new BrowserlessClient(
        makeConfig({ BROWSER_POOL_TOKEN: 'tok' }),
        makeJwt(),
      );
      expect(() => client.profilePath('', 'instagram')).toThrow(
        /Refusing to build profile path with empty segments/,
      );
    });
  });

  describe('buildCdpUrl', () => {
    it('includes token, launch JSON, and the tenant-scoped user-data-dir', () => {
      const client = new BrowserlessClient(
        makeConfig({
          BROWSER_POOL_TOKEN: 'secret-token',
          BROWSER_POOL_INTERNAL_URL: 'ws://pool.local:3000',
        }),
        makeJwt(),
      );

      const url = new URL(client.buildCdpUrl('alice', 'instagram'));
      expect(url.protocol).toBe('ws:');
      expect(url.host).toBe('pool.local:3000');
      expect(url.pathname).toBe('/chromium');
      expect(url.searchParams.get('token')).toBe('secret-token');

      // Type the parse result up front — JSON.parse returns `any`, and the
      // surrounding asserts are noisy with no-unsafe-* warnings otherwise.
      const launch = JSON.parse(url.searchParams.get('launch') ?? '{}') as {
        args: string[];
        headless: boolean;
        stealth?: boolean;
      };
      expect(launch.args).toContain(
        '--user-data-dir=/profiles/alice/instagram',
      );
      expect(launch.args).toContain('--no-sandbox');
      expect(launch.headless).toBe(false);
      // No stealth on the pool launch — see browserless.client.ts comment.
      // Pinned in the test so a future re-add gets caught alongside the
      // browserless crash repro.
      expect(launch.stealth).toBeUndefined();
    });

    it('throws if BROWSER_POOL_TOKEN is unset (no half-authenticated URLs)', () => {
      const client = new BrowserlessClient(makeConfig({}), makeJwt());
      expect(() => client.buildCdpUrl('alice', 'instagram')).toThrow(
        /BROWSER_POOL_TOKEN missing/,
      );
    });

    it('honours BROWSER_POOL_CDP_PATH override for self-hosted variants', () => {
      const client = new BrowserlessClient(
        makeConfig({
          BROWSER_POOL_TOKEN: 'tok',
          BROWSER_POOL_INTERNAL_URL: 'ws://pool:3000',
          BROWSER_POOL_CDP_PATH: '/playwright',
        }),
        makeJwt(),
      );
      const url = new URL(client.buildCdpUrl('u', 'p'));
      expect(url.pathname).toBe('/playwright');
    });
  });

  describe('buildVncUrl', () => {
    it('signs a session-scoped JWT and embeds it in the configured template', () => {
      const jwt = makeJwt();
      const client = new BrowserlessClient(
        makeConfig({
          BROWSER_POOL_TOKEN: 'tok',
          BROWSER_POOL_PUBLIC_URL: 'https://browser.example.com',
        }),
        jwt,
      );

      const vnc = client.buildVncUrl('alice', 'browser-abc-123');

      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: 'alice', sid: 'browser-abc-123', scope: 'browser:vnc' },
        { expiresIn: '15m' },
      );
      // The default template puts the session id and signed token into the
      // query string so the pool sidecar can verify before letting the VNC
      // stream through. URL-encoded values, so don't compare raw.
      const parsed = new URL(vnc);
      expect(parsed.origin).toBe('https://browser.example.com');
      expect(parsed.pathname).toBe('/live');
      expect(parsed.searchParams.get('id')).toBe('browser-abc-123');
      expect(parsed.searchParams.get('token')).toBe('signed.jwt.value');
    });

    it('respects a custom URL template (image-portable)', () => {
      const client = new BrowserlessClient(
        makeConfig({
          BROWSER_POOL_TOKEN: 'tok',
          BROWSER_POOL_PUBLIC_URL: 'https://b.example.com',
          BROWSER_POOL_VNC_URL_TEMPLATE: '/sessions/{sessionId}/live?t={token}',
        }),
        makeJwt(),
      );
      const url = new URL(client.buildVncUrl('alice', 'sid-99'));
      expect(url.pathname).toBe('/sessions/sid-99/live');
      expect(url.searchParams.get('t')).toBe('signed.jwt.value');
    });
  });
});
