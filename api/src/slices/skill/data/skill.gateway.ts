import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISkillGateway } from '../domain/skill.gateway';
import {
  ISkillData,
  ICreateSkillData,
  IUpdateSkillData,
  ISkillDependentAgent,
  ISkillOrderItem,
} from '../domain/skill.types';
import { estimateTokens } from '../domain/tokens';
import { SkillMapper, SKILL_INCLUDE } from './skill.mapper';

@Injectable()
export class SkillGateway extends ISkillGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: SkillMapper,
  ) {
    super();
  }

  async findAll(): Promise<ISkillData[]> {
    const records = await this.prisma.skill.findMany({
      // The admin's library order; name breaks ties left by the migration
      // default (0) or a deleted neighbour.
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: SKILL_INCLUDE,
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ISkillData | null> {
    const record = await this.prisma.skill.findUnique({
      where: { id },
      include: SKILL_INCLUDE,
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByName(name: string): Promise<ISkillData | null> {
    const record = await this.prisma.skill.findUnique({
      where: { name },
      include: SKILL_INCLUDE,
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByIds(ids: string[]): Promise<ISkillData[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.skill.findMany({
      where: { id: { in: ids } },
      include: SKILL_INCLUDE,
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async create(data: ICreateSkillData): Promise<ISkillData> {
    // Last position in the library, decided inside the insert's transaction
    // so two imports in the same second cannot land on the same number.
    const record = await this.prisma.$transaction(async (tx) => {
      const last = await tx.skill.aggregate({ _max: { sortOrder: true } });
      return tx.skill.create({
        data: {
          ...this.mapper.toCreate(data),
          sortOrder: (last._max.sortOrder ?? 0) + 1,
        },
        include: SKILL_INCLUDE,
      });
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateSkillData): Promise<ISkillData> {
    const { files, ...rest } = data;
    const record = await this.prisma.skill.update({
      where: { id },
      data: {
        ...rest,
        ...(files !== undefined ? { files: files as unknown as object } : {}),
        ...(typeof rest.body === 'string'
          ? { tokenEstimate: estimateTokens(rest.body) }
          : {}),
      },
      include: SKILL_INCLUDE,
    });
    return this.mapper.toEntity(record);
  }

  async readOrder(): Promise<ISkillOrderItem[]> {
    return this.prisma.skill.findMany({
      select: { id: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async writeOrder(
    items: ISkillOrderItem[],
    guard: (current: ISkillOrderItem[]) => void,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Row locks: a second save waits here, then sees the first one's
      // positions and fails the guard instead of overwriting them.
      const current = await tx.$queryRaw<ISkillOrderItem[]>`
        SELECT "id", "sortOrder" FROM "Skill" ORDER BY "id" FOR UPDATE`;
      guard(current);
      const ids = items.map((i) => i.id);
      const orders = items.map((i) => i.sortOrder);
      // One statement, and not `tx.skill.update`, so Prisma's @updatedAt does
      // not stamp every skill as edited because somebody dragged a row.
      await tx.$executeRaw`
        UPDATE "Skill" AS s SET "sortOrder" = v.ord
        FROM unnest(${ids}::text[], ${orders}::int[]) AS v(id, ord)
        WHERE s."id" = v.id`;
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.skill.delete({ where: { id } });
  }

  async findDependentAgents(id: string): Promise<ISkillDependentAgent[]> {
    const record = await this.prisma.skill.findUnique({
      where: { id },
      select: {
        templates: {
          select: {
            id: true,
            name: true,
            agents: {
              select: { id: true, name: true, status: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!record) return [];
    return record.templates.flatMap((t) =>
      t.agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        templateId: t.id,
        templateName: t.name,
      })),
    );
  }
}
