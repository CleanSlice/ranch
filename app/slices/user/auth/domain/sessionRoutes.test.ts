import { describe, expect, test } from 'bun:test';
import { restoresSession } from './sessionRoutes';

describe('restoresSession', () => {
  test('the console restores the session wherever it is entered', () => {
    for (const path of ['/', '/login', '/agents', '/agents/a1', '/chats', '/profile']) {
      expect(restoresSession(path)).toBe(true);
    }
  });

  test('the share page does not: a visitor page asks the API nothing about a console session', () => {
    expect(restoresSession('/share')).toBe(false);
    expect(restoresSession('/share/')).toBe(false);
  });

  test('only the share page itself, not a route that merely starts like it', () => {
    expect(restoresSession('/shared')).toBe(true);
    expect(restoresSession('/share-links')).toBe(true);
  });
});
