import { ApiKeyMapper } from './apiKey.mapper';
import { ApiKeyScopeTypes } from '../domain/apiKey.types';

/**
 * The mapper drops a scope it does not know without a word. A key created
 * with a new scope would then read back with no scopes at all and unlock
 * nothing — so every scope the enum has must survive a round trip.
 */
describe('ApiKeyMapper.normalizeScopes', () => {
  const mapper = new ApiKeyMapper();

  it('keeps events:write', () => {
    expect(mapper.normalizeScopes(['events:write'])).toEqual([
      ApiKeyScopeTypes.EventsWrite,
    ]);
  });

  it('keeps every scope the enum declares', () => {
    const all = Object.values(ApiKeyScopeTypes);
    expect(mapper.normalizeScopes(all)).toEqual(all);
  });

  it('still drops a value it does not know, and dedupes', () => {
    expect(
      mapper.normalizeScopes(['events:write', 'events:read', 'events:write']),
    ).toEqual([ApiKeyScopeTypes.EventsWrite]);
  });
});
