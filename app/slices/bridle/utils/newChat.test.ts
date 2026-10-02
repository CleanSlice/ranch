import { describe, expect, test } from 'bun:test';
import {
  newChatBlock,
  newChatFailureKey,
  newChatHintKey,
  type INewChatInput,
} from './newChat';

// A conversation "New chat" is available for: something to start over from,
// a live channel, a reachable agent that is not answering.
const READY: INewChatInput = {
  resetting: false,
  messageCount: 3,
  connected: true,
  hasClientId: true,
  agentOnline: true,
  answering: false,
};

describe('newChatBlock', () => {
  test('nothing blocks a quiet conversation with a reachable agent', () => {
    expect(newChatBlock(READY)).toBe(null);
  });

  test('a reset already in flight', () => {
    expect(newChatBlock({ ...READY, resetting: true })).toBe('busy');
  });

  test('nothing to start over from', () => {
    expect(newChatBlock({ ...READY, messageCount: 0 })).toBe('empty');
  });

  test('no live channel', () => {
    expect(newChatBlock({ ...READY, connected: false })).toBe('offline');
  });

  test('connected, but the hub has not said who this is yet', () => {
    expect(newChatBlock({ ...READY, hasClientId: false })).toBe('offline');
  });

  test('the agent is off the hub', () => {
    expect(newChatBlock({ ...READY, agentOnline: false })).toBe(
      'agent_offline',
    );
  });

  test('not having heard about the agent yet counts as off the hub', () => {
    expect(newChatBlock({ ...READY, agentOnline: undefined })).toBe(
      'agent_offline',
    );
  });

  test('the agent is still answering', () => {
    expect(newChatBlock({ ...READY, answering: true })).toBe('answering');
  });
});

describe('newChatBlock — one reason at a time, the nearest cause first', () => {
  test('a reset in flight outranks an empty conversation', () => {
    expect(newChatBlock({ ...READY, resetting: true, messageCount: 0 })).toBe(
      'busy',
    );
  });

  test('an empty conversation outranks a missing channel', () => {
    expect(newChatBlock({ ...READY, messageCount: 0, connected: false })).toBe(
      'empty',
    );
  });

  test('a missing channel outranks an unreachable agent', () => {
    expect(
      newChatBlock({ ...READY, connected: false, agentOnline: false }),
    ).toBe('offline');
  });

  test('an unreachable agent outranks an answer in progress', () => {
    expect(
      newChatBlock({ ...READY, agentOnline: false, answering: true }),
    ).toBe('agent_offline');
  });
});

describe('newChatHintKey', () => {
  test('says what the button does when it is available', () => {
    expect(newChatHintKey(null)).toBe('chat.new_chat_hint');
  });

  test('says why when it is not', () => {
    expect(newChatHintKey('empty')).toBe('chat.new_chat_empty');
    expect(newChatHintKey('offline')).toBe('chat.new_chat_offline');
    expect(newChatHintKey('agent_offline')).toBe('chat.new_chat_agent_offline');
    expect(newChatHintKey('answering')).toBe('chat.new_chat_answering');
    expect(newChatHintKey('busy')).toBe('chat.new_chat_starting');
  });
});

describe('newChatFailureKey', () => {
  test('the agent could not be reached', () => {
    expect(newChatFailureKey('AGENT_OFFLINE')).toBe(
      'chat.new_chat_failed_agent_offline',
    );
  });

  test('the agent was still answering', () => {
    expect(newChatFailureKey('TURN_IN_PROGRESS')).toBe(
      'chat.new_chat_failed_answering',
    );
  });

  test('anything else, a code the console does not know included', () => {
    expect(newChatFailureKey('SYNC_FAILED')).toBe('chat.new_chat_failed');
    expect(newChatFailureKey('SOMETHING_NEW')).toBe('chat.new_chat_failed');
    expect(newChatFailureKey(undefined)).toBe('chat.new_chat_failed');
  });
});
