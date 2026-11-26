import { describe, expect, test } from 'bun:test';
import {
  counterLabel,
  panelLocation,
  parsePanelView,
  stepBack,
  type PanelView,
} from './panelView';

const CHAT: PanelView = { kind: 'chat' };
const LIST: PanelView = { kind: 'list' };
const READING: PanelView = { kind: 'conversation', chatId: 'c1' };

describe('parsePanelView', () => {
  test('no query is the chat', () => {
    expect(parsePanelView({})).toEqual(CHAT);
  });

  test('view=history is the list', () => {
    expect(parsePanelView({ view: 'history' })).toEqual(LIST);
  });

  test('view=history with a chat id is that conversation', () => {
    expect(parsePanelView({ view: 'history', chat: 'c1' })).toEqual(READING);
  });

  test('an unknown view is the chat', () => {
    expect(parsePanelView({ view: 'settings' })).toEqual(CHAT);
    expect(parsePanelView({ view: 'settings', chat: 'c1' })).toEqual(CHAT);
  });

  test('a chat id without view=history is the chat', () => {
    expect(parsePanelView({ chat: 'c1' })).toEqual(CHAT);
  });

  test('a repeated parameter counts once, an empty chat id not at all', () => {
    expect(parsePanelView({ view: ['history', 'x'], chat: ['c1', 'c2'] })).toEqual(READING);
    expect(parsePanelView({ view: 'history', chat: '' })).toEqual(LIST);
    expect(parsePanelView({ view: 'history', chat: null })).toEqual(LIST);
  });
});

describe('panelLocation', () => {
  test('the chat is the agent address with nothing after it', () => {
    expect(panelLocation('a1', CHAT)).toEqual({ path: '/agents/a1', query: {} });
  });

  test('every view survives the round trip through its address', () => {
    for (const view of [CHAT, LIST, READING]) {
      expect(parsePanelView(panelLocation('a1', view).query)).toEqual(view);
    }
  });

  test('an agent id is written into the path as one segment', () => {
    expect(panelLocation('a/b', LIST).path).toBe('/agents/a%2Fb');
  });
});

describe('stepBack', () => {
  test('a conversation goes back to the list, the list to the chat', () => {
    expect(stepBack(READING)).toEqual(LIST);
    expect(stepBack(LIST)).toEqual(CHAT);
  });

  test('there is nothing behind the chat', () => {
    expect(stepBack(CHAT)).toBe(null);
  });
});

describe('counterLabel', () => {
  test('nothing known, or nothing closed, shows no counter', () => {
    expect(counterLabel(null)).toBe(null);
    expect(counterLabel(undefined)).toBe(null);
    expect(counterLabel(0)).toBe(null);
  });

  test('up to 99 is the number itself', () => {
    expect(counterLabel(1)).toBe('1');
    expect(counterLabel(99)).toBe('99');
  });

  test('more than 99 is capped', () => {
    expect(counterLabel(100)).toBe('99+');
    expect(counterLabel(2500)).toBe('99+');
  });
});
