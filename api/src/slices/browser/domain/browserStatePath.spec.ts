import {
  browserStatePath,
  identityFolder,
  legacyBrowserStatePath,
} from './browserStatePath';

// CLEAN-244: the flat `<identity>-<profile>.json` let share visitor
// `share-abc` open `share-abc-def`'s "private" session as "def-private".
describe('browser state paths', () => {
  it('one folder per identity, so dashes can no longer meet', () => {
    expect(browserStatePath('share-abc-def', 'private')).toBe(
      'browser-state/share-abc-def/private.json',
    );
    expect(browserStatePath('share-abc', 'def-private')).toBe(
      'browser-state/share-abc/def-private.json',
    );
    expect(browserStatePath('admin', 'shadow')).toBe(
      'browser-state/admin/shadow.json',
    );
  });

  it('encodes an identity reversibly, as the runtime does', () => {
    expect(identityFolder('user-8c10214e-9566-4b5e-8126-cc291346a452')).toBe(
      'user-8c10214e-9566-4b5e-8126-cc291346a452',
    );
    expect(identityFolder('..')).toBe('~2e~2e');
    expect(identityFolder('a/b')).toBe('a~2fb');
    expect(identityFolder('~2e')).toBe('~7e2e');
  });

  it('keeps the old name for runtimes before 0.39, for unambiguous ids only', () => {
    expect(legacyBrowserStatePath('admin', 'shadow')).toBe(
      'browser-state/admin-shadow.json',
    );
    expect(legacyBrowserStatePath('share-abc', 'x')).toBe(null);
    expect(legacyBrowserStatePath('user', 'x')).toBe(null);
    expect(legacyBrowserStatePath('55212224/../../etc', 'x')).toBe(null);
  });
});
