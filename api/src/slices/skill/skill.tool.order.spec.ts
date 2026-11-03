import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { SkillTool } from './skill.tool';
import type { ISkillGateway, ISkillData } from './domain';
import type { GithubSearch } from './data/github.search';
import type { SkillOrderService } from './domain/skillOrder.service';
import { ORDER_CHANGED } from './domain/skillOrder.service';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * CLEAN-205: the console can drag the library into an order and pick a
 * group; the chat must be able to do both (docs/agent-tools.md). These
 * cover `reorder_skills` and the `group` argument of `create_skill`.
 */
const request = (roles: UserRoleTypes[]): Request =>
  ({ user: { sub: 'agent:agent-ops', email: '', roles } }) as unknown as Request;
const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

function harness() {
  const skills = {
    create: jest
      .fn()
      .mockImplementation(async (data: Partial<ISkillData>) =>
        ({ id: 'skill-new', ...data }) as ISkillData,
      ),
  };
  const order = {
    reorderByNames: jest.fn().mockResolvedValue({
      order: [
        { name: 'mazda-year', position: 1 },
        { name: 'alm-api', position: 2 },
      ],
      unknown: [],
    }),
  };
  const tool = new SkillTool(
    skills as unknown as ISkillGateway,
    {} as GithubSearch,
    order as unknown as SkillOrderService,
  );
  return { tool, skills, order };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('reorder_skills', () => {
  it('is operator-only', async () => {
    const { tool, order } = harness();
    await expect(
      tool.reorderSkills({ names: ['alm-api'] }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(order.reorderByNames).not.toHaveBeenCalled();
  });

  it('hands the names to the same order service the console uses', async () => {
    const { tool, order } = harness();
    const text = textOf(
      await tool.reorderSkills({ names: ['mazda-year'] }, null, operator()),
    );
    expect(order.reorderByNames).toHaveBeenCalledWith(['mazda-year']);
    expect(text).toContain('"position": 1');
    expect(text).toContain('mazda-year');
  });

  it('tells the model to retry when the console saved in between', async () => {
    const { tool, order } = harness();
    order.reorderByNames.mockRejectedValue(new ConflictException(ORDER_CHANGED));
    const text = textOf(
      await tool.reorderSkills({ names: ['alm-api'] }, null, operator()),
    );
    expect(text).toContain('try again');
  });
});

describe('create_skill with a group', () => {
  it('passes the group through to the gateway', async () => {
    const { tool, skills } = harness();
    await tool.createSkill(
      { name: 'routes', title: 'Routes', body: '# r', group: 'routing' },
      null,
      operator(),
    );
    expect(skills.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'routes', group: 'routing' }),
    );
  });
});
