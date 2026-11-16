import { describe, expect, test } from 'bun:test';
import {
  findLimitProblem,
  formToLimits,
  formatRoomIn,
  isLimitFormEmpty,
  limitNumbersToForm,
  limitTextToNumber,
  limitsToForm,
  parseLimitField,
  placeRefusal,
  placeRefusalByField,
} from './agentLimitForm';

const form = (minute = '', hour = '', day = '') => ({ minute, hour, day });

describe('limit fields — text and limits', () => {
  test('limits become text, a window without a limit an empty field', () => {
    expect(limitsToForm({ perMinute: 20, perHour: null, perDay: 2000 })).toEqual(
      form('20', '', '2000'),
    );
    expect(limitsToForm(null)).toEqual(form());
    expect(limitsToForm(undefined)).toEqual(form());
  });

  test('an empty field is "not limited", a number is itself', () => {
    expect(parseLimitField('')).toBe(null);
    expect(parseLimitField('   ')).toBe(null);
    expect(parseLimitField(' 30 ')).toBe(30);
    expect(parseLimitField('1')).toBe(1);
    expect(parseLimitField('1000000')).toBe(1000000);
  });

  test('anything else is not a limit', () => {
    expect(parseLimitField('0')).toBe(undefined);
    expect(parseLimitField('-3')).toBe(undefined);
    expect(parseLimitField('1.5')).toBe(undefined);
    expect(parseLimitField('1e3')).toBe(undefined);
    expect(parseLimitField('ten')).toBe(undefined);
    expect(parseLimitField('1000001')).toBe(undefined);
  });

  test('all three empty is limits off', () => {
    expect(isLimitFormEmpty(form())).toBe(true);
    expect(formToLimits(form())).toBe(null);
    expect(formToLimits(form(' ', '', ''))).toBe(null);
  });

  test('one filled field is enough for limits', () => {
    expect(formToLimits(form('', '300'))).toEqual({
      perMinute: null,
      perHour: 300,
      perDay: null,
    });
  });
});

describe('limit fields — problems', () => {
  test('nothing wrong with a private agent and empty fields', () => {
    expect(findLimitProblem(form(), false)).toBe(null);
  });

  test('nothing wrong with equal neighbours', () => {
    expect(findLimitProblem(form('20', '20', '20'), true)).toBe(null);
  });

  test('a value out of range is placed on its own field', () => {
    const problem = findLimitProblem(form('20', '0', ''), true);
    expect(problem?.code).toBe('LIMIT_OUT_OF_RANGE');
    expect(problem?.place).toBe('hour');
    expect(problem?.text).toBe(
      'Enter a whole number from 1 to 1,000,000, or leave the field empty for no limit.',
    );
  });

  test('a longer window lower than a shorter one is placed on the longer field', () => {
    const problem = findLimitProblem(form('20', '10', ''), false);
    expect(problem?.code).toBe('LIMIT_WINDOWS_CONTRADICT');
    expect(problem?.place).toBe('hour');
    expect(problem?.text).toBe(
      'The limit per hour (10) is lower than the limit per minute (20), so the per minute limit could never be reached. Raise this one or lower the other.',
    );
  });

  test('minute against day is caught with the hour left empty', () => {
    const problem = findLimitProblem(form('500', '', '100'), false);
    expect(problem?.code).toBe('LIMIT_WINDOWS_CONTRADICT');
    expect(problem?.place).toBe('day');
  });

  test('a public agent with empty fields is placed on the group', () => {
    const problem = findLimitProblem(form(), true);
    expect(problem?.code).toBe('PUBLIC_AGENT_NEEDS_LIMITS');
    expect(problem?.place).toBe('limits');
  });
});

describe('limit fields — a refusal from the server', () => {
  test('is placed where the form shows the same problem', () => {
    const placed = placeRefusal('LIMIT_WINDOWS_CONTRADICT', 'server text', form('20', '10'), true);
    expect(placed?.place).toBe('hour');
  });

  test('goes under the group when the form looks fine here', () => {
    const placed = placeRefusal('PUBLIC_AGENT_NEEDS_LIMITS', 'server text', form('20'), true);
    expect(placed?.place).toBe('limits');
    expect(placed?.text).toBe(
      'A public agent needs at least one limit. Fill in a limit, or keep the agent private.',
    );
  });

  test('keeps the server wording for a contradiction it alone saw', () => {
    const placed = placeRefusal('LIMIT_WINDOWS_CONTRADICT', 'server text', form('20', '30'), false);
    expect(placed).toEqual({
      code: 'LIMIT_WINDOWS_CONTRADICT',
      place: 'limits',
      text: 'server text',
    });
  });

  test('is not a limit problem when the code is something else, or absent', () => {
    expect(placeRefusal('AGENT_NOT_FOUND', 'nope', form(), true)).toBe(null);
    expect(placeRefusal(null, 'Network down', form(), true)).toBe(null);
  });
});

describe('limit fields — a refusal placed for the whole page', () => {
  const needsLimits =
    'A public agent needs at least one limit. Fill in a limit, or keep the agent private.';

  test('"public needs limits" goes in the limit block AND by the landing-page switch', () => {
    const placed = placeRefusalByField('PUBLIC_AGENT_NEEDS_LIMITS', 'server text', form(), true);
    expect(placed).toEqual([
      { code: 'PUBLIC_AGENT_NEEDS_LIMITS', place: 'limits', text: needsLimits },
      { code: 'PUBLIC_AGENT_NEEDS_LIMITS', place: 'public', text: needsLimits },
    ]);
  });

  test('… also when the form looks fine here and only the server saw it', () => {
    const placed = placeRefusalByField('PUBLIC_AGENT_NEEDS_LIMITS', 'server text', form('20'), false);
    expect(placed.length).toBe(2);
    expect(placed[0]?.place).toBe('limits');
    expect(placed[1]?.place).toBe('public');
  });

  test('a value out of range stays by its field', () => {
    const placed = placeRefusalByField('LIMIT_OUT_OF_RANGE', 'server text', form('20', '0'), true);
    expect(placed.length).toBe(1);
    expect(placed[0]?.place).toBe('hour');
    expect(placed[0]?.code).toBe('LIMIT_OUT_OF_RANGE');
  });

  test('a contradiction stays by the longer field', () => {
    const placed = placeRefusalByField('LIMIT_WINDOWS_CONTRADICT', 'server text', form('500', '', '100'), true);
    expect(placed.length).toBe(1);
    expect(placed[0]?.place).toBe('day');
  });

  test('a code that is not about limits is placed nowhere', () => {
    expect(placeRefusalByField('AGENT_NOT_FOUND', 'nope', form(), true)).toEqual([]);
    expect(placeRefusalByField(null, 'Network down', form(), true)).toEqual([]);
  });
});

describe('limit fields — numbers held by the page draft', () => {
  test('text becomes a number, an empty field null', () => {
    expect(limitTextToNumber('')).toBe(null);
    expect(limitTextToNumber('  ')).toBe(null);
    expect(limitTextToNumber(' 30 ')).toBe(30);
  });

  test('digits out of range stay a number, for the save to refuse by the field', () => {
    expect(limitTextToNumber('0')).toBe(0);
    expect(limitTextToNumber('1000001')).toBe(1000001);
  });

  test('anything else is NaN — a change that cannot be sent', () => {
    expect(Number.isNaN(limitTextToNumber('ten'))).toBe(true);
    expect(Number.isNaN(limitTextToNumber('1.5'))).toBe(true);
    expect(Number.isNaN(limitTextToNumber('-3'))).toBe(true);
  });

  test('numbers go back to the text the checks read', () => {
    expect(limitNumbersToForm({ perMinute: 20, perHour: null, perDay: 0 })).toEqual(
      form('20', '', '0'),
    );
    const unreadable = limitNumbersToForm({ perMinute: Number.NaN, perHour: null, perDay: null });
    expect(findLimitProblem(unreadable, false)?.code).toBe('LIMIT_OUT_OF_RANGE');
    expect(findLimitProblem(unreadable, false)?.place).toBe('minute');
  });
});

describe('formatRoomIn', () => {
  test('seconds, minutes and hours in the two largest units', () => {
    expect(formatRoomIn(42)).toBe('42 s');
    expect(formatRoomIn(60)).toBe('1 min');
    expect(formatRoomIn(725)).toBe('12 min 5 s');
    expect(formatRoomIn(3600)).toBe('1 h');
    expect(formatRoomIn(7500)).toBe('2 h 5 min');
  });

  test('never zero and never negative', () => {
    expect(formatRoomIn(0)).toBe('1 s');
    expect(formatRoomIn(-5)).toBe('1 s');
    expect(formatRoomIn(0.2)).toBe('1 s');
  });
});
