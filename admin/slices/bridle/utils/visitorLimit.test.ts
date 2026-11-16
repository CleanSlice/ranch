import { describe, expect, test } from 'bun:test'
import {
  applyAgentLimit,
  clearVisitorLimit,
  pruneVisitorLimits,
  type VisitorLimits,
} from './visitorLimit'

const NOW = 10_000

describe('agent_limit → visitorLimits', () => {
  test('a full window sets the entry for its agent, on the given clock', () => {
    const next = applyAgentLimit(
      {},
      { type: 'agent_limit', agentId: 'a', limited: true, retryAfterMs: 42_000, window: 'hour' },
      NOW,
    )
    expect(next).toEqual({ a: { until: 52_000, window: 'hour' } })
  })

  test('limited:false clears the entry and leaves the other agents alone', () => {
    const state: VisitorLimits = {
      a: { until: 52_000, window: 'hour' },
      b: { until: 90_000, window: 'day' },
    }
    const next = applyAgentLimit(state, { type: 'agent_limit', agentId: 'a', limited: false }, NOW)
    expect(next).toEqual({ b: { until: 90_000, window: 'day' } })
  })

  test('a second event for the same agent replaces the wait', () => {
    const state: VisitorLimits = { a: { until: 52_000, window: 'hour' } }
    const next = applyAgentLimit(
      state,
      { agentId: 'a', limited: true, retryAfterMs: 5_000, window: 'day' },
      NOW,
    )
    expect(next).toEqual({ a: { until: 15_000, window: 'day' } })
  })

  test('an event without an agent id belongs to the socket it came on', () => {
    const next = applyAgentLimit({}, { limited: true, retryAfterMs: 1_000, window: 'day' }, NOW, 'a')
    expect(next).toEqual({ a: { until: 11_000, window: 'day' } })
  })

  test('a wait that is already over clears instead of setting', () => {
    const state: VisitorLimits = { a: { until: 52_000, window: 'hour' } }
    expect(applyAgentLimit(state, { agentId: 'a', limited: true, retryAfterMs: 0, window: 'hour' }, NOW)).toEqual({})
  })

  test('clearing an agent that has no entry returns the same state', () => {
    const state: VisitorLimits = { b: { until: 90_000, window: 'day' } }
    expect(applyAgentLimit(state, { agentId: 'a', limited: false }, NOW) === state).toBe(true)
  })

  test('anything it cannot read changes nothing and does not throw', () => {
    const state: VisitorLimits = { a: { until: 52_000, window: 'hour' } }
    expect(applyAgentLimit(state, null, NOW) === state).toBe(true)
    expect(applyAgentLimit(state, 'agent_limit', NOW) === state).toBe(true)
    expect(applyAgentLimit(state, { limited: true, retryAfterMs: 1_000 }, NOW) === state).toBe(true)
    expect(applyAgentLimit(state, { agentId: 'a', limited: true }, NOW) === state).toBe(true)
    expect(applyAgentLimit(state, { agentId: 'a', limited: true, retryAfterMs: 'soon' }, NOW) === state).toBe(true)
    expect(applyAgentLimit(state, { agentId: 'a', limited: 'yes', retryAfterMs: 5 }, NOW) === state).toBe(true)
  })

  test('an unknown window still puts the line up', () => {
    const next = applyAgentLimit({}, { agentId: 'a', limited: true, retryAfterMs: 1_000, window: 'week' }, NOW)
    expect(next).toEqual({ a: { until: 11_000, window: 'hour' } })
  })
})

describe('visitorLimits — when the wait passes', () => {
  test('entries whose time has come are dropped, the rest stay', () => {
    const state: VisitorLimits = {
      a: { until: 9_000, window: 'hour' },
      b: { until: 10_000, window: 'hour' },
      c: { until: 10_001, window: 'day' },
    }
    expect(pruneVisitorLimits(state, NOW)).toEqual({ c: { until: 10_001, window: 'day' } })
  })

  test('nothing due returns the same state', () => {
    const state: VisitorLimits = { c: { until: 10_001, window: 'day' } }
    expect(pruneVisitorLimits(state, NOW) === state).toBe(true)
  })

  test('a reconnect forgets one agent', () => {
    const state: VisitorLimits = {
      a: { until: 52_000, window: 'hour' },
      b: { until: 90_000, window: 'day' },
    }
    expect(clearVisitorLimit(state, 'a')).toEqual({ b: { until: 90_000, window: 'day' } })
  })
})
