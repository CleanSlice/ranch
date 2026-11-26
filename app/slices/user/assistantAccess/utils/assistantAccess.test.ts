import { describe, expect, test } from 'bun:test';
import { agentAbilitiesThroughAssistant, badgeCardShift } from './assistantAccess';

describe('what the assistant may do to an agent somebody else made (CLEAN-259)', () => {
  const ability = (title: string, state: string, onAgent: boolean) => ({ title, state, onAgent });
  const mine = (enabled: boolean) => ({
    enabled,
    areas: [
      {
        abilities: [
          ability('List agents', 'included', false),
          ability('Restart an agent', 'included', true),
          ability('Show an agent’s logs', 'own_agents_only', true),
          ability('Delete an agent', 'not_included', true),
        ],
      },
      { abilities: [ability('Connect two agents', 'included', true)] },
    ],
  });

  test('the included abilities that act on an agent, by title, in the order received', () => {
    expect(agentAbilitiesThroughAssistant(mine(true))).toEqual([
      'Restart an agent',
      'Connect two agents',
    ]);
  });

  test('nothing while the assistant is off for them, or nothing has been read', () => {
    expect(agentAbilitiesThroughAssistant(mine(false))).toEqual([]);
    expect(agentAbilitiesThroughAssistant(null)).toEqual([]);
    expect(agentAbilitiesThroughAssistant(undefined)).toEqual([]);
  });
});

describe('where the person’s own card hangs', () => {
  test('from the badge while it fits', () => {
    expect(badgeCardShift(24, 1440, 288)).toBe(0);
    expect(badgeCardShift(16, 390, 288)).toBe(0);
  });

  test('moved left on a phone, as far as it takes and no further', () => {
    // 390 wide, badge at 200: the card would end at 488.
    const shift = badgeCardShift(200, 390, 288);
    expect(shift).toBe(-114);
    expect(200 + shift + 288).toBe(390 - 16);
  });

  test('never past the left gutter, on a screen narrower than the card', () => {
    const width = 320 - 32;
    const shift = badgeCardShift(250, 320, width);
    expect(250 + shift).toBe(16);
    expect(250 + shift + width).toBe(320 - 16);
  });
});
