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
