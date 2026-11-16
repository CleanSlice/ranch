import { describe, expect, test } from 'bun:test';
import {
  agentDraft,
  setDraftField,
  type DraftAgent,
  type DraftField,
  type DraftTouched,
} from './agentDraft';

const agent = (over: Partial<DraftAgent> = {}): DraftAgent => ({
  name: 'Support',
  config: { description: 'Answers customers', a2a: { enabled: true } },
  llmCredentialId: 'llm-1',
  knowledgeIds: ['kb-1', 'kb-2'],
  resources: { cpu: '500m', memory: '2Gi' },
  debugEnabled: false,
  isPublic: false,
  allowedOrigins: ['https://a.test', 'https://b.test'],
  ...over,
});

const limits = { perMinute: 20, perHour: null, perDay: 2000 };

describe('agentDraft — value', () => {
  test('an untouched field is what is saved', () => {
    const draft = agentDraft(agent(), limits, {});
    expect(draft.value('name')).toBe('Support');
    expect(draft.value('description')).toBe('Answers customers');
    expect(draft.value('llmCredentialId')).toBe('llm-1');
    expect(draft.value('knowledgeIds')).toEqual(['kb-1', 'kb-2']);
    expect(draft.value('cpu')).toBe('500m');
    expect(draft.value('memory')).toBe('2Gi');
    expect(draft.value('debugEnabled')).toBe(false);
    expect(draft.value('isPublic')).toBe(false);
    expect(draft.value('allowedOrigins')).toEqual(['https://a.test', 'https://b.test']);
    expect(draft.value('perMinute')).toBe(20);
    expect(draft.value('perHour')).toBe(null);
    expect(draft.value('perDay')).toBe(2000);
    expect(draft.count).toBe(0);
  });

  test('a description that is absent, or not text, is empty', () => {
    expect(agentDraft(agent({ config: {} }), null, {}).value('description')).toBe('');
    expect(
      agentDraft(agent({ config: { description: 7 } }), null, {}).value('description'),
    ).toBe('');
  });

  test('limits that are off, or not read yet, are three empty fields', () => {
    const off = agentDraft(agent(), null, {});
    expect(off.value('perMinute')).toBe(null);
    expect(off.value('perHour')).toBe(null);
    expect(off.value('perDay')).toBe(null);
    expect(agentDraft(agent(), undefined, {}).value('perDay')).toBe(null);
  });

  test('a touched field is what the operator typed', () => {
    const draft = agentDraft(agent(), limits, { name: 'Sales', perHour: 300 });
    expect(draft.value('name')).toBe('Sales');
    expect(draft.value('perHour')).toBe(300);
    expect(draft.value('memory')).toBe('2Gi');
  });
});

describe('agentDraft — changed', () => {
  const cases: Array<[DraftField, DraftTouched]> = [
    ['name', { name: 'Sales' }],
    ['description', { description: 'Sells' }],
    ['llmCredentialId', { llmCredentialId: 'llm-2' }],
    ['knowledgeIds', { knowledgeIds: ['kb-1'] }],
    ['cpu', { cpu: '1' }],
    ['memory', { memory: '4Gi' }],
    ['debugEnabled', { debugEnabled: true }],
    ['isPublic', { isPublic: true }],
    ['allowedOrigins', { allowedOrigins: ['https://a.test'] }],
    ['perMinute', { perMinute: 30 }],
    ['perHour', { perHour: 300 }],
    ['perDay', { perDay: null }],
  ];

  test('every editable field counts once when it differs from what is saved', () => {
    for (let i = 0; i < cases.length; i += 1) {
      const [field, touched] = cases[i]!;
      const draft = agentDraft(agent(), limits, touched);
      expect(draft.changed(field)).toBe(true);
      expect(draft.count).toBe(1);
      expect(draft.changedFields).toEqual([field]);
    }
  });

  test('clearing the credential is a change', () => {
    expect(agentDraft(agent(), limits, { llmCredentialId: null }).changed('llmCredentialId')).toBe(true);
  });

  test('a field touched but equal to what is saved is not changed', () => {
    const draft = agentDraft(agent(), limits, {
      name: 'Support',
      perMinute: 20,
      isPublic: false,
    });
    expect(draft.changed('name')).toBe(false);
    expect(draft.changed('perMinute')).toBe(false);
    expect(draft.changed('isPublic')).toBe(false);
    expect(draft.count).toBe(0);
  });

  test('text is compared trimmed', () => {
    const draft = agentDraft(agent(), limits, {
      name: '  Support ',
      description: 'Answers customers  ',
      cpu: ' 500m',
      memory: '2Gi ',
    });
    expect(draft.count).toBe(0);
  });

  test('knowledge ids are compared as a set', () => {
    const same = agentDraft(agent(), limits, { knowledgeIds: ['kb-2', 'kb-1'] });
    expect(same.changed('knowledgeIds')).toBe(false);
    const more = agentDraft(agent(), limits, { knowledgeIds: ['kb-2', 'kb-1', 'kb-3'] });
    expect(more.changed('knowledgeIds')).toBe(true);
    const template = agentDraft(agent(), limits, { knowledgeIds: [] });
    expect(template.changed('knowledgeIds')).toBe(true);
  });

  test('origins are compared as an ordered list', () => {
    const same = agentDraft(agent(), limits, {
      allowedOrigins: ['https://a.test', 'https://b.test'],
    });
    expect(same.changed('allowedOrigins')).toBe(false);
    const reordered = agentDraft(agent(), limits, {
      allowedOrigins: ['https://b.test', 'https://a.test'],
    });
    expect(reordered.changed('allowedOrigins')).toBe(true);
  });

  test('a limit field holding text that is not a number is a change', () => {
    const draft = agentDraft(agent(), limits, { perMinute: Number.NaN });
    expect(draft.changed('perMinute')).toBe(true);
  });

  test('several fields across blocks are counted together', () => {
    const draft = agentDraft(agent(), limits, {
      name: 'Sales',
      llmCredentialId: 'llm-2',
      perMinute: 30,
      isPublic: true,
    });
    expect(draft.count).toBe(4);
    expect(draft.changedFields).toEqual(['name', 'llmCredentialId', 'isPublic', 'perMinute']);
  });
});

describe('agentDraft — what is saved moves', () => {
  test('an untouched field follows it, a touched one does not', () => {
    const touched: DraftTouched = { name: 'Sales' };
    const moved = agent({ name: 'Renamed elsewhere', debugEnabled: true });
    const draft = agentDraft(moved, { perMinute: 5, perHour: null, perDay: null }, touched);
    expect(draft.value('name')).toBe('Sales');
    expect(draft.changed('name')).toBe(true);
    expect(draft.value('debugEnabled')).toBe(true);
    expect(draft.changed('debugEnabled')).toBe(false);
    expect(draft.value('perMinute')).toBe(5);
    expect(draft.count).toBe(1);
  });

  test('a touched field stops being a change when the saved value catches up', () => {
    const draft = agentDraft(agent({ name: 'Sales' }), limits, { name: 'Sales' });
    expect(draft.changed('name')).toBe(false);
    expect(draft.count).toBe(0);
  });
});

describe('setDraftField', () => {
  test('records the edit and leaves the earlier ones', () => {
    const first = setDraftField(agent(), limits, {}, 'name', 'Sales');
    const second = setDraftField(agent(), limits, first, 'perHour', 300);
    expect(second).toEqual({ name: 'Sales', perHour: 300 });
    expect(first).toEqual({ name: 'Sales' });
  });

  test('a field set back to its saved value is untouched again', () => {
    const edited = setDraftField(agent(), limits, {}, 'name', 'Sales');
    const back = setDraftField(agent(), limits, edited, 'name', 'Support');
    expect(back).toEqual({});
    // … and so follows what is saved from then on.
    const draft = agentDraft(agent({ name: 'Renamed elsewhere' }), limits, back);
    expect(draft.value('name')).toBe('Renamed elsewhere');
    expect(draft.count).toBe(0);
  });

  test('discard is an empty draft', () => {
    const draft = agentDraft(agent(), limits, {});
    expect(draft.count).toBe(0);
    expect(draft.payload()).toEqual({});
  });
});

describe('agentDraft — restart and save path', () => {
  test('"Save and restart" is offered for cpu and memory only', () => {
    expect(agentDraft(agent(), limits, { cpu: '1' }).needsRestartOffer).toBe(true);
    expect(agentDraft(agent(), limits, { memory: '4Gi' }).needsRestartOffer).toBe(true);
    expect(
      agentDraft(agent(), limits, { name: 'Sales', isPublic: true, perMinute: 1 })
        .needsRestartOffer,
    ).toBe(false);
    expect(agentDraft(agent(), limits, {}).needsRestartOffer).toBe(false);
  });

  test('every change marks a pending restart except the three limits', () => {
    const marking: DraftTouched[] = [
      { name: 'Sales' },
      { description: 'Sells' },
      { llmCredentialId: 'llm-2' },
      { knowledgeIds: [] },
      { cpu: '1' },
      { memory: '4Gi' },
      { debugEnabled: true },
      { isPublic: true },
      { allowedOrigins: [] },
    ];
    for (let i = 0; i < marking.length; i += 1) {
      expect(agentDraft(agent(), limits, marking[i]!).marksPendingRestart).toBe(true);
    }
    expect(
      agentDraft(agent(), limits, { perMinute: 1, perHour: 2, perDay: 3 }).marksPendingRestart,
    ).toBe(false);
    expect(agentDraft(agent(), limits, {}).marksPendingRestart).toBe(false);
    expect(
      agentDraft(agent(), limits, { perMinute: 1, name: 'Sales' }).marksPendingRestart,
    ).toBe(true);
  });

  test('the public switch and the limits go through the limit path', () => {
    expect(agentDraft(agent(), limits, { isPublic: true }).touchesLimitPath).toBe(true);
    expect(agentDraft(agent(), limits, { perMinute: 1 }).touchesLimitPath).toBe(true);
    expect(agentDraft(agent(), limits, { perHour: 100 }).touchesLimitPath).toBe(true);
    expect(agentDraft(agent(), limits, { perDay: null }).touchesLimitPath).toBe(true);
    expect(
      agentDraft(agent(), limits, { name: 'Sales', allowedOrigins: [] }).touchesLimitPath,
    ).toBe(false);
    expect(agentDraft(agent(), limits, { isPublic: false }).touchesLimitPath).toBe(false);
  });
});

describe('agentDraft — payload', () => {
  test('carries changed fields only', () => {
    const draft = agentDraft(agent(), limits, {
      name: ' Sales ',
      debugEnabled: true,
      isPublic: false,
      memory: '2Gi',
    });
    expect(draft.payload()).toEqual({ name: 'Sales', debugEnabled: true });
  });

  test('every agent field in its place', () => {
    const draft = agentDraft(agent(), limits, {
      llmCredentialId: null,
      knowledgeIds: ['kb-3'],
      isPublic: true,
      allowedOrigins: ['https://c.test'],
    });
    expect(draft.payload()).toEqual({
      llmCredentialId: null,
      knowledgeIds: ['kb-3'],
      isPublic: true,
      allowedOrigins: ['https://c.test'],
    });
  });

  test('cpu or memory alone sends both resources', () => {
    expect(agentDraft(agent(), limits, { cpu: ' 1 ' }).payload()).toEqual({
      resources: { cpu: '1', memory: '2Gi' },
    });
    expect(agentDraft(agent(), limits, { memory: '4Gi' }).payload()).toEqual({
      resources: { cpu: '500m', memory: '4Gi' },
    });
  });

  test('description is set inside the config that is saved NOW', () => {
    const touched: DraftTouched = { description: ' Sells ' };
    // The config moved after the page opened: the new key must survive.
    const moved = agent({
      config: { description: 'Answers customers', a2a: { enabled: false }, added: 1 },
    });
    expect(agentDraft(moved, limits, touched).payload()).toEqual({
      config: { description: 'Sells', a2a: { enabled: false }, added: 1 },
    });
  });

  test('an emptied description removes the key', () => {
    const draft = agentDraft(agent(), limits, { description: '   ' });
    expect(draft.payload()).toEqual({ config: { a2a: { enabled: true } } });
  });

  test('the payload does not alias the saved config', () => {
    const saved = agent();
    agentDraft(saved, limits, { description: 'Sells' }).payload();
    expect(saved.config).toEqual({ description: 'Answers customers', a2a: { enabled: true } });
  });

  test('limits are present only when a limit changed, and always all three', () => {
    expect(agentDraft(agent(), limits, { isPublic: true }).payload()).toEqual({
      isPublic: true,
    });
    expect(agentDraft(agent(), limits, { perHour: 300 }).payload()).toEqual({
      limits: { perMinute: 20, perHour: 300, perDay: 2000 },
    });
  });

  test('all three emptied is limits off', () => {
    const draft = agentDraft(agent(), limits, { perMinute: null, perDay: null });
    expect(draft.payload()).toEqual({ limits: null });
    expect(draft.limits()).toBe(null);
  });

  test('a public agent with no limit states its limits when its origins change', () => {
    const legacy = agent({ isPublic: true });
    const draft = agentDraft(legacy, null, { allowedOrigins: ['https://c.test'] });
    expect(draft.touchesLimitPath).toBe(true);
    expect(draft.payload()).toEqual({ allowedOrigins: ['https://c.test'], limits: null });
    // With a limit, or private, the origins travel alone.
    const capped = agentDraft(legacy, limits, { allowedOrigins: ['https://c.test'] });
    expect(capped.touchesLimitPath).toBe(false);
    expect(capped.payload()).toEqual({ allowedOrigins: ['https://c.test'] });
    const hidden = agentDraft(agent(), null, { allowedOrigins: ['https://c.test'] });
    expect(hidden.touchesLimitPath).toBe(false);
    expect(hidden.payload()).toEqual({ allowedOrigins: ['https://c.test'] });
  });

  test('limits() is what the three fields say, changed or not', () => {
    expect(agentDraft(agent(), limits, {}).limits()).toEqual(limits);
    expect(agentDraft(agent(), null, {}).limits()).toBe(null);
    expect(agentDraft(agent(), null, { perDay: 9 }).limits()).toEqual({
      perMinute: null,
      perHour: null,
      perDay: 9,
    });
  });
});
