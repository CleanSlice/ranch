import { BadRequestException, ConflictException } from '@nestjs/common';
import { SkillOrderService } from './skillOrder.service';
import type { ISkillGateway } from './skill.gateway';
import type { ISkillData, ISkillOrderItem } from './skill.types';

/**
 * The order is the one thing on the Skills page that every admin shares, so
 * what matters is that a stale save is refused, a partial list is refused,
 * and the chat's "put X first" lands exactly where a drag would.
 */
const items = (pairs: [string, number][]): ISkillOrderItem[] =>
  pairs.map(([id, sortOrder]) => ({ id, sortOrder }));

const skillOf = (id: string, name: string): ISkillData =>
  ({ id, name }) as ISkillData;

function harness(current: ISkillOrderItem[]) {
  const skills = {
    readOrder: jest.fn().mockResolvedValue(current),
    writeOrder: jest
      .fn()
      .mockImplementation(
        async (
          _items: ISkillOrderItem[],
          guard: (rows: ISkillOrderItem[]) => void,
        ) => {
          guard(current);
        },
      ),
    findAll: jest
      .fn()
      .mockResolvedValue([
        skillOf('a', 'alm-api'),
        skillOf('b', 'mazda-year'),
        skillOf('c', 'runtime-tools'),
      ]),
  };
  const service = new SkillOrderService(skills as unknown as ISkillGateway);
  return { service, skills };
}

describe('SkillOrderService.version', () => {
  const { service } = harness([]);

  it('does not depend on the row order of the query', () => {
    const a = service.version(
      items([
        ['a', 1],
        ['b', 2],
      ]),
    );
    const b = service.version(
      items([
        ['b', 2],
        ['a', 1],
      ]),
    );
    expect(a).toBe(b);
  });

  it('changes when a position changes', () => {
    const a = service.version(
      items([
        ['a', 1],
        ['b', 2],
      ]),
    );
    const b = service.version(
      items([
        ['a', 2],
        ['b', 1],
      ]),
    );
    expect(a).not.toBe(b);
  });

  it('changes when a skill appears or disappears', () => {
    const a = service.version(
      items([
        ['a', 1],
        ['b', 2],
      ]),
    );
    const b = service.version(items([['a', 1]]));
    expect(a).not.toBe(b);
  });
});

describe('SkillOrderService.save', () => {
  const current = items([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);

  it('writes a full permutation against the current version', async () => {
    const { service, skills } = harness(current);
    const next = items([
      ['b', 1],
      ['a', 2],
      ['c', 3],
    ]);
    await service.save(service.version(current), next);
    expect(skills.writeOrder).toHaveBeenCalledWith(next, expect.any(Function));
  });

  it('refuses a save against a version that has moved on (409 ORDER_CHANGED)', async () => {
    const { service, skills } = harness(current);
    const stale = service.version(
      items([
        ['a', 1],
        ['b', 2],
      ]),
    );
    await expect(
      service.save(
        stale,
        items([
          ['b', 1],
          ['a', 2],
          ['c', 3],
        ]),
      ),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: { code: 'ORDER_CHANGED' },
    });
    // The guard threw inside the transaction; nothing else was attempted.
    expect(skills.writeOrder).toHaveBeenCalledTimes(1);
  });

  it('refuses a list that misses a skill', async () => {
    const { service } = harness(current);
    await expect(
      service.save(
        service.version(current),
        items([
          ['a', 1],
          ['b', 2],
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses repeated ids and repeated positions before touching the DB', async () => {
    const { service, skills } = harness(current);
    await expect(
      service.save(
        'v',
        items([
          ['a', 1],
          ['a', 2],
          ['c', 3],
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save(
        'v',
        items([
          ['a', 1],
          ['b', 1],
          ['c', 3],
        ]),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(skills.writeOrder).not.toHaveBeenCalled();
  });
});

describe('SkillOrderService.reorderByNames', () => {
  const current = items([
    ['a', 1],
    ['b', 2],
    ['c', 3],
  ]);

  it('moves the named skills to the front and keeps the rest in order', async () => {
    const { service, skills } = harness(current);
    const result = await service.reorderByNames(['mazda-year']);
    expect(skills.writeOrder).toHaveBeenCalledWith(
      items([
        ['b', 1],
        ['a', 2],
        ['c', 3],
      ]),
      expect.any(Function),
    );
    expect(result.order.map((o) => o.name)).toEqual([
      'mazda-year',
      'alm-api',
      'runtime-tools',
    ]);
    expect(result.unknown).toEqual([]);
  });

  it('reports unknown names and still applies the known ones', async () => {
    const { service, skills } = harness(current);
    const result = await service.reorderByNames(['nope', 'runtime-tools']);
    expect(result.unknown).toEqual(['nope']);
    expect(skills.writeOrder).toHaveBeenCalledWith(
      items([
        ['c', 1],
        ['a', 2],
        ['b', 3],
      ]),
      expect.any(Function),
    );
  });

  it('writes nothing when no name is known', async () => {
    const { service, skills } = harness(current);
    const result = await service.reorderByNames(['nope']);
    expect(result.unknown).toEqual(['nope']);
    expect(skills.writeOrder).not.toHaveBeenCalled();
  });
});
