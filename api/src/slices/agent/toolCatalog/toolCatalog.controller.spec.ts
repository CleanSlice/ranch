import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ToolCatalogController } from './toolCatalog.controller';

describe('ToolCatalogController', () => {
  const catalog = {
    forAgent: jest.fn(async (id: string) => ({ agentId: id, podStartedAt: null, listedAt: null, groups: [] })),
  };
  const controller = new ToolCatalogController(catalog as never);
  const req = (sub: string) => ({ user: { sub, roles: ['owner'] } }) as unknown as Request;

  it('answers a person with the catalogue', async () => {
    const result = await controller.tools('agent-1', req('user-1'));
    expect(result.agentId).toBe('agent-1');
    expect(catalog.forAgent).toHaveBeenCalledWith('agent-1');
  });

  it('refuses an agent token even when it carries Owner', async () => {
    await expect(controller.tools('agent-1', req('agent:admin'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
