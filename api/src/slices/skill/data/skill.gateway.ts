import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISkillGateway } from '../domain/skill.gateway';
import {
  ISkillData,
  ICreateSkillData,
  IUpdateSkillData,
} from '../domain/skill.types';
import { SkillMapper } from './skill.mapper';

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
      orderBy: [{ name: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ISkillData | null> {
    const record = await this.prisma.skill.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByIds(ids: string[]): Promise<ISkillData[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.skill.findMany({
      where: { id: { in: ids } },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async create(data: ICreateSkillData): Promise<ISkillData> {
    const record = await this.prisma.skill.create({
      data: this.mapper.toCreate(data),
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
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.skill.delete({ where: { id } });
  }
}
