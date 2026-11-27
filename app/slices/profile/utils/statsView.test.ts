import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PERIOD,
  DEFAULT_SCOPE,
  DEFAULT_STATS_VIEW,
  DEFAULT_TAB,
  PERIODS,
  SCOPES,
  TABS,
  canSeeInstallation,
  isCorrection,
  parseStatsView,
  statsLocation,
  type IStatsView,
} from './statsView';

const view = (over: Partial<IStatsView> = {}): IStatsView => ({
  tab: 'stats',
  period: 30,
  scope: 'mine',
  ...over,
});

describe('the constants of the address', () => {
  test('values and defaults are the ones in contracts/ui.md', () => {
    expect([...TABS]).toEqual(['stats', 'account']);
    expect([...PERIODS]).toEqual([7, 30, 90]);
    expect([...SCOPES]).toEqual(['mine', 'installation']);
    expect(DEFAULT_TAB).toBe('stats');
    expect(DEFAULT_PERIOD).toBe(30);
    expect(DEFAULT_SCOPE).toBe('mine');
    expect(DEFAULT_STATS_VIEW).toEqual(view());
  });
});

describe('canSeeInstallation', () => {
  test('the Owner and an Admin, whatever the letter case', () => {
    expect(canSeeInstallation('Owner')).toBe(true);
    expect(canSeeInstallation('Admin')).toBe(true);
    expect(canSeeInstallation('owner')).toBe(true);
    expect(canSeeInstallation('ADMIN')).toBe(true);
  });

  test('nobody else: a User, an unknown role, no role', () => {
    expect(canSeeInstallation('User')).toBe(false);
    expect(canSeeInstallation('Agent')).toBe(false);
    expect(canSeeInstallation('')).toBe(false);
    expect(canSeeInstallation(null)).toBe(false);
    expect(canSeeInstallation(undefined)).toBe(false);
  });
});

describe('parseStatsView', () => {
  test('no query is the statistics of 30 days, mine', () => {
    expect(parseStatsView({}, 'User')).toEqual(view());
    expect(parseStatsView({}, 'Owner')).toEqual(view());
  });

  test('tab: stats and account are read, anything else is stats', () => {
    expect(parseStatsView({ tab: 'stats' }, 'User').tab).toBe('stats');
    expect(parseStatsView({ tab: 'account' }, 'User').tab).toBe('account');
    expect(parseStatsView({ tab: 'settings' }, 'User').tab).toBe('stats');
    expect(parseStatsView({ tab: 'Account' }, 'User').tab).toBe('stats');
    expect(parseStatsView({ tab: '' }, 'User').tab).toBe('stats');
    expect(parseStatsView({ tab: null }, 'User').tab).toBe('stats');
  });

  test('period: 7, 30 and 90 are read, anything else is 30', () => {
    expect(parseStatsView({ period: '7' }, 'User').period).toBe(7);
    expect(parseStatsView({ period: '30' }, 'User').period).toBe(30);
    expect(parseStatsView({ period: '90' }, 'User').period).toBe(90);
    expect(parseStatsView({ period: '14' }, 'User').period).toBe(30);
    expect(parseStatsView({ period: '07' }, 'User').period).toBe(30);
    expect(parseStatsView({ period: '7d' }, 'User').period).toBe(30);
    expect(parseStatsView({ period: 'week' }, 'User').period).toBe(30);
    expect(parseStatsView({ period: '' }, 'User').period).toBe(30);
    expect(parseStatsView({ period: null }, 'User').period).toBe(30);
  });

  test('scope: an operator reads mine and installation, anything else is mine', () => {
    expect(parseStatsView({ scope: 'mine' }, 'Admin').scope).toBe('mine');
    expect(parseStatsView({ scope: 'installation' }, 'Admin').scope).toBe('installation');
    expect(parseStatsView({ scope: 'installation' }, 'Owner').scope).toBe('installation');
    expect(parseStatsView({ scope: 'everyone' }, 'Owner').scope).toBe('mine');
    expect(parseStatsView({ scope: '' }, 'Owner').scope).toBe('mine');
  });

  test('scope=installation is read as mine for a User and for a role nobody knows', () => {
    expect(parseStatsView({ scope: 'installation' }, 'User').scope).toBe('mine');
    expect(parseStatsView({ scope: 'installation' }, 'Agent').scope).toBe('mine');
    expect(parseStatsView({ scope: 'installation' }, '').scope).toBe('mine');
    expect(parseStatsView({ scope: 'installation' }, null).scope).toBe('mine');
    expect(parseStatsView({ scope: 'installation' }, undefined).scope).toBe('mine');
  });

  test('all three together', () => {
    expect(
      parseStatsView({ tab: 'stats', period: '90', scope: 'installation' }, 'Owner'),
    ).toEqual(view({ period: 90, scope: 'installation' }));
    expect(
      parseStatsView({ tab: 'stats', period: '90', scope: 'installation' }, 'User'),
    ).toEqual(view({ period: 90 }));
  });

  test('the account tab has no period and no scope: both read as defaults', () => {
    expect(
      parseStatsView({ tab: 'account', period: '7', scope: 'installation' }, 'Owner'),
    ).toEqual(view({ tab: 'account' }));
  });

  test('a repeated parameter counts once', () => {
    expect(
      parseStatsView({ tab: ['stats', 'account'], period: ['7', '90'] }, 'User'),
    ).toEqual(view({ period: 7 }));
  });

  test('parameters of somebody else are not read', () => {
    expect(parseStatsView({ view: 'history', chat: 'c1' }, 'Owner')).toEqual(view());
  });
});

describe('statsLocation', () => {
  test('the default view is the bare address', () => {
    expect(statsLocation(view())).toEqual({ path: '/profile', query: {} });
  });

  test('each value that is not the default is written, each default is left out', () => {
    expect(statsLocation(view({ period: 7 })).query).toEqual({ period: '7' });
    expect(statsLocation(view({ period: 90 })).query).toEqual({ period: '90' });
    expect(statsLocation(view({ scope: 'installation' })).query).toEqual({
      scope: 'installation',
    });
    expect(statsLocation(view({ period: 90, scope: 'installation' })).query).toEqual({
      period: '90',
      scope: 'installation',
    });
  });

  test('the account tab carries the tab alone', () => {
    expect(statsLocation(view({ tab: 'account' }))).toEqual({
      path: '/profile',
      query: { tab: 'account' },
    });
    expect(
      statsLocation(view({ tab: 'account', period: 7, scope: 'installation' })).query,
    ).toEqual({ tab: 'account' });
  });

  test('every view an operator can reach survives the round trip', () => {
    for (let p = 0; p < PERIODS.length; p++) {
      for (let s = 0; s < SCOPES.length; s++) {
        const stats = view({ period: PERIODS[p], scope: SCOPES[s] });
        expect(parseStatsView(statsLocation(stats).query, 'Owner')).toEqual(stats);
        expect(parseStatsView(statsLocation(stats).query, 'Admin')).toEqual(stats);
      }
    }
    const account = view({ tab: 'account' });
    expect(parseStatsView(statsLocation(account).query, 'Owner')).toEqual(account);
  });

  test('every view a User can reach survives the round trip', () => {
    for (let p = 0; p < PERIODS.length; p++) {
      const stats = view({ period: PERIODS[p] });
      expect(parseStatsView(statsLocation(stats).query, 'User')).toEqual(stats);
    }
    const account = view({ tab: 'account' });
    expect(parseStatsView(statsLocation(account).query, 'User')).toEqual(account);
  });
});

describe('isCorrection', () => {
  const corrected = (query: Record<string, unknown>, role: string) =>
    isCorrection(query, parseStatsView(query, role));

  test('an address written by statsLocation needs nothing', () => {
    expect(corrected({}, 'User')).toBe(false);
    expect(corrected({ period: '7' }, 'User')).toBe(false);
    expect(corrected({ period: '90', scope: 'installation' }, 'Owner')).toBe(false);
    expect(corrected({ tab: 'account' }, 'User')).toBe(false);
  });

  test('an unknown value is corrected', () => {
    expect(corrected({ tab: 'settings' }, 'User')).toBe(true);
    expect(corrected({ period: '14' }, 'User')).toBe(true);
    expect(corrected({ scope: 'everyone' }, 'Owner')).toBe(true);
  });

  test('the installation scope is corrected for a User and left for an operator', () => {
    expect(corrected({ scope: 'installation' }, 'User')).toBe(true);
    expect(corrected({ scope: 'installation' }, 'Admin')).toBe(false);
  });

  test('a default spelled out is corrected: one view, one address', () => {
    expect(corrected({ tab: 'stats' }, 'User')).toBe(true);
    expect(corrected({ period: '30' }, 'User')).toBe(true);
    expect(corrected({ scope: 'mine' }, 'User')).toBe(true);
  });

  test('a period or a scope on the account tab is corrected', () => {
    expect(corrected({ tab: 'account', period: '7' }, 'User')).toBe(true);
    expect(corrected({ tab: 'account', scope: 'installation' }, 'Owner')).toBe(true);
  });

  test('an empty or repeated parameter is corrected', () => {
    expect(corrected({ period: '' }, 'User')).toBe(true);
    expect(corrected({ tab: null }, 'User')).toBe(true);
    expect(corrected({ period: ['7', '90'] }, 'User')).toBe(true);
    expect(corrected({ period: ['7'] }, 'User')).toBe(true);
  });

  test('parameters of somebody else are nobody to correct', () => {
    expect(corrected({ ref: 'mail' }, 'User')).toBe(false);
    expect(corrected({ ref: 'mail', period: '7' }, 'User')).toBe(false);
  });

  test('it compares the address with the view it is given', () => {
    expect(isCorrection({ period: '7' }, view({ period: 90 }))).toBe(true);
    expect(isCorrection({ period: '90' }, view({ period: 90 }))).toBe(false);
  });
});
