import { BrowserMapper } from './browser.mapper';
import { BrowserSessionStatusTypes } from '../domain';

describe('BrowserMapper', () => {
  const mapper = new BrowserMapper();

  describe('toEntity', () => {
    it('passes Prisma row fields through and casts status to enum', () => {
      const now = new Date('2026-05-17T12:00:00Z');
      const entity = mapper.toEntity({
        id: 'browser-abc',
        userId: 'user-1',
        accountKey: 'instagram',
        status: 'needs_login',
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      } as Parameters<BrowserMapper['toEntity']>[0]);

      expect(entity).toEqual({
        id: 'browser-abc',
        userId: 'user-1',
        accountKey: 'instagram',
        status: BrowserSessionStatusTypes.NeedsLogin,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  describe('toCreate', () => {
    it('mints a browser-prefixed UUID id and stamps lastUsedAt', () => {
      const before = Date.now();
      const created = mapper.toCreate({
        userId: 'user-1',
        accountKey: 'paypal:main',
      });
      const after = Date.now();

      // ID convention is enforced by toCreate — anyone changing it should
      // break this test loudly so storage paths / external references stay
      // consistent.
      expect(created.id).toMatch(
        /^browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(created.userId).toBe('user-1');
      expect(created.accountKey).toBe('paypal:main');
      expect(created.status).toBe(BrowserSessionStatusTypes.Idle);
      const stampedAt = created.lastUsedAt.getTime();
      expect(stampedAt).toBeGreaterThanOrEqual(before);
      expect(stampedAt).toBeLessThanOrEqual(after);
    });

    it('produces a unique id per call', () => {
      const a = mapper.toCreate({ userId: 'u', accountKey: 'x' });
      const b = mapper.toCreate({ userId: 'u', accountKey: 'x' });
      expect(a.id).not.toBe(b.id);
    });
  });
});
