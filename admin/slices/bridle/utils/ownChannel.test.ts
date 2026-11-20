import { describe, expect, test } from 'bun:test'
import { ownChannel } from './ownChannel'

describe('the channel of the signed-in person’s own conversation', () => {
  test('the Owner keeps the conversation the administrators shared', () => {
    expect(ownChannel({ id: 'user-o', role: 'Owner' })).toBe('admin')
  })

  test('an Admin has their own, and never the Owner’s', () => {
    expect(ownChannel({ id: 'user-a', role: 'Admin' })).toBe('user-a')
    expect(ownChannel({ id: 'user-b', role: 'Admin' })).toBe('user-b')
  })

  test('so does anybody else with an account', () => {
    expect(ownChannel({ id: 'user-u', role: 'User' })).toBe('user-u')
  })

  test('nobody signed in yet falls back to the old name, which the API then refuses or answers for the Owner', () => {
    expect(ownChannel(null)).toBe('admin')
    expect(ownChannel({ id: '', role: 'Admin' })).toBe('admin')
  })
})
