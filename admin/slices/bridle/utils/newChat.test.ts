import { describe, expect, test } from 'bun:test'
import { newChatFailureNotice, newChatRefusalCode } from './newChat'

describe('what the console says when a new chat could not be started', () => {
  test('an agent that is off the hub is named as the reason', () => {
    expect(newChatFailureNotice('AGENT_OFFLINE')).toBe(
      'The agent is unavailable, so a new chat could not be started. The conversation is unchanged.',
    )
  })

  test('so is an answer still being written', () => {
    expect(newChatFailureNotice('TURN_IN_PROGRESS')).toBe(
      'The agent is still answering. Try again when it has finished.',
    )
  })

  test('anything else gets the general sentence, never the code', () => {
    const general = 'Could not start a new chat. The conversation is unchanged.'
    expect(newChatFailureNotice('SYNC_FAILED')).toBe(general)
    expect(newChatFailureNotice('SOMETHING_NEW')).toBe(general)
    expect(newChatFailureNotice(undefined)).toBe(general)
  })
})

describe('the refusal code in an error body', () => {
  test('is read from the body itself', () => {
    expect(newChatRefusalCode({ code: 'AGENT_OFFLINE' })).toBe('AGENT_OFFLINE')
  })

  test('or from inside the envelope', () => {
    expect(newChatRefusalCode({ success: false, data: { code: 'TURN_IN_PROGRESS' } })).toBe(
      'TURN_IN_PROGRESS',
    )
  })

  test('and is absent when the body carries none, or is not an object', () => {
    expect(newChatRefusalCode({ message: 'Conflict' })).toBe(undefined)
    expect(newChatRefusalCode({ code: 409 })).toBe(undefined)
    expect(newChatRefusalCode(null)).toBe(undefined)
    expect(newChatRefusalCode('Conflict')).toBe(undefined)
  })
})
