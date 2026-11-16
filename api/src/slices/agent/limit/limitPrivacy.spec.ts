import { readFileSync } from 'fs';
import * as path from 'path';
import { Agent } from '@prisma/client';
import { AgentMapper } from '#/agent/agent/data/agent.mapper';
import { PUBLIC_METADATA_KEY } from '#/user/auth/guards/public.decorator';
import { AgentLimitController } from './agentLimit.controller';

/**
 * Limit values, usage figures and "this agent is at its limit" are for the
 * people who may edit the agent (FR-051). The agent record is not such a
 * place: it is what `GET /agents/public` returns and what the status stream
 * sends to anyone who subscribes, signed in or not (CLEAN-225). So limits
 * live in their own table and travel on their own routes, and this file is
 * what notices if someone later "just adds the field to the agent".
 */
const LIMIT_WORDS = [
  'perMinute',
  'perHour',
  'perDay',
  'atLimit',
  'needsLimits',
  'retryAfter',
  'AgentLimit',
  'AgentLoad',
];

const source = (relative: string) =>
  readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('request limits stay off every anonymous surface', () => {
  it('keeps them off the agent record that the public list and the status stream carry', () => {
    const record = new AgentMapper().toEntity({
      id: 'a',
      config: {},
      resources: {},
    } as unknown as Agent);

    for (const key of Object.keys(record)) {
      expect(key.toLowerCase()).not.toContain('limit');
      expect(key.toLowerCase()).not.toContain('load');
    }
  });

  it.each([
    // What an agent looks like on the wire.
    'agent/dtos/agent.dto.ts',
    'agent/domain/agent.types.ts',
    'agent/data/agent.mapper.ts',
    // What the status stream sends.
    'agent/domain/agentStatus.service.ts',
    'agent/dtos/agentStatus.dto.ts',
  ])('%s names nothing about limits', (file) => {
    const text = source(file);
    for (const word of LIMIT_WORDS) {
      expect(text).not.toContain(word);
    }
  });

  it('has no public route in the limits controller', () => {
    expect(
      Reflect.getMetadata(PUBLIC_METADATA_KEY, AgentLimitController),
    ).toBeUndefined();
    for (const name of Object.getOwnPropertyNames(
      AgentLimitController.prototype,
    )) {
      const handler = (
        AgentLimitController.prototype as unknown as Record<string, unknown>
      )[name];
      if (typeof handler !== 'function') continue;
      expect(Reflect.getMetadata(PUBLIC_METADATA_KEY, handler)).toBeUndefined();
    }
  });
});
