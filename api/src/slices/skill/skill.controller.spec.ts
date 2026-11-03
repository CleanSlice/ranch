import { ConflictException } from '@nestjs/common';
import { SkillController } from './skill.controller';
import type { ISkillGateway, ISkillData } from './domain';
import type { GithubSearch } from './data/github.search';
import type { SkillOrderService } from './domain/skillOrder.service';

/**
 * CLEAN-205: the two things the New / Edit skill form leans on — the
 * name-available read it calls as the admin types, and the 409 the unique
 * index turns into when two tabs race to the same slug.
 */
const skill = (overrides: Partial<ISkillData> = {}): ISkillData =>
  ({
    id: 'skill-1',
    name: 'devops',
    title: 'DevOps engineer',
    ...overrides,
  }) as ISkillData;

function harness() {
  const gateway = {
    findByName: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation(async (data: Partial<ISkillData>) =>
        skill({ id: 'skill-new', ...data }),
      ),
    update: jest
      .fn()
      .mockImplementation(async (id: string, data: Partial<ISkillData>) =>
        skill({ id, ...data }),
      ),
  };
  const controller = new SkillController(
    gateway as unknown as ISkillGateway,
    {} as GithubSearch,
    {} as SkillOrderService,
  );
  return { controller, gateway };
}

describe('GET /skills/name-available', () => {
  it('is available when no skill holds the name', async () => {
    const { controller } = harness();
    await expect(controller.nameAvailable({ name: 'devops' })).resolves.toEqual({
      name: 'devops',
      available: true,
    });
  });

  it('is taken, naming the holder', async () => {
    const { controller, gateway } = harness();
    gateway.findByName.mockResolvedValue(skill());
    await expect(controller.nameAvailable({ name: 'devops' })).resolves.toEqual({
      name: 'devops',
      available: false,
      existingId: 'skill-1',
    });
  });

  it('is available for the skill that holds it (Edit keeps its own name)', async () => {
    const { controller, gateway } = harness();
    gateway.findByName.mockResolvedValue(skill());
    await expect(
      controller.nameAvailable({ name: 'devops', excludeId: 'skill-1' }),
    ).resolves.toEqual({ name: 'devops', available: true });
  });
});

describe('duplicate names on create and update', () => {
  const p2002 = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });

  it('turns the unique violation into 409 SKILL_EXISTS with the holder', async () => {
    const { controller, gateway } = harness();
    gateway.create.mockRejectedValue(p2002);
    gateway.findByName.mockResolvedValue(skill());
    await expect(
      controller.create({ name: 'devops', title: 'x', body: 'y' }),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: {
        code: 'SKILL_EXISTS',
        existing: { id: 'skill-1', name: 'devops' },
      },
    });
  });

  it('does the same on a rename', async () => {
    const { controller, gateway } = harness();
    gateway.update.mockRejectedValue(p2002);
    await expect(
      controller.update('skill-2', { name: 'devops' }),
    ).rejects.toMatchObject({ response: { code: 'SKILL_EXISTS' } });
  });

  it('leaves every other error alone', async () => {
    const { controller, gateway } = harness();
    gateway.create.mockRejectedValue(new Error('boom'));
    await expect(
      controller.create({ name: 'devops', title: 'x', body: 'y' }),
    ).rejects.toThrow('boom');
  });
});
