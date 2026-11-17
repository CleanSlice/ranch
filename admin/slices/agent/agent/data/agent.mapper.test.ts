import { describe, expect, test } from 'bun:test';
import { AgentMapper } from './agent.mapper';

const mapper = new AgentMapper();

describe('AgentMapper.toUpdateDto', () => {
  test('a cleared credential is sent as null, not dropped', () => {
    const dto = mapper.toUpdateDto({ llmCredentialId: null }) as Record<string, unknown>;
    expect('llmCredentialId' in dto).toBe(true);
    expect(dto.llmCredentialId).toBe(null);
    expect(JSON.stringify(dto)).toBe('{"llmCredentialId":null}');
  });

  test('a credential that was not touched is not in the body', () => {
    const dto = mapper.toUpdateDto({ name: 'Sales' }) as Record<string, unknown>;
    expect('llmCredentialId' in dto).toBe(false);
    expect(dto).toEqual({ name: 'Sales' });
  });

  test('a chosen credential and the rest of the body pass through', () => {
    expect(
      mapper.toUpdateDto({ llmCredentialId: 'llm-2', limits: null, isPublic: false }) as Record<string, unknown>,
    ).toEqual({ llmCredentialId: 'llm-2', limits: null, isPublic: false });
  });
});

describe('AgentMapper.toCreateDto', () => {
  test('no credential on create is left out', () => {
    const dto = mapper.toCreateDto({ name: 'Sales', templateId: 't-1', llmCredentialId: null });
    expect(dto.llmCredentialId).toBe(undefined);
  });
});

describe('AgentMapper.toEntity: who created the agent (CLEAN-232)', () => {
  const row = (extra: Record<string, unknown>) => ({ id: 'agent-1', name: 'Sales', ...extra });

  test('a resolved creator is kept as it came', () => {
    expect(
      mapper.toEntity(row({ createdBy: { id: 'u-1', name: 'Ada', email: 'ada@example.test' } }))?.createdBy,
    ).toEqual({ id: 'u-1', name: 'Ada', email: 'ada@example.test' });
  });

  test('a removed account keeps its id and has no name or email', () => {
    expect(
      mapper.toEntity(row({ createdBy: { id: 'u-gone', name: null, email: null } }))?.createdBy,
    ).toEqual({ id: 'u-gone', name: null, email: null });
  });

  test('null says nobody is recorded', () => {
    expect(mapper.toEntity(row({ createdBy: null }))?.createdBy).toBe(null);
  });

  test('a payload that does not carry the field says nothing: undefined, not null', () => {
    // The status stream is anonymous and never carries it. The store keeps
    // what it knew for `undefined`; `null` would wipe it.
    const decoded = mapper.toEntity(row({}));
    expect(decoded?.createdBy).toBe(undefined);
  });

  test('a creator without an id is nobody, and a bare id never passes for one', () => {
    expect(mapper.toEntity(row({ createdBy: { name: 'Ada' } }))?.createdBy).toBe(null);
    expect(mapper.toEntity(row({ createdBy: 'u-1' }))?.createdBy).toBe(null);
    expect(mapper.toEntity(row({ createdById: 'u-1' }))?.createdBy).toBe(undefined);
  });
});
