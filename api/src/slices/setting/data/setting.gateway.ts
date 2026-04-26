import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ISettingGateway } from '../domain/setting.gateway';
import { ISettingData, IUpsertSettingData } from '../domain/setting.types';
import { SettingMapper } from './setting.mapper';

@Injectable()
export class SettingGateway extends ISettingGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: SettingMapper,
  ) {
    super();
  }

  async findAll(): Promise<ISettingData[]> {
    const records = await this.prisma.setting.findMany({
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findByGroup(group: string): Promise<ISettingData[]> {
    const records = await this.prisma.setting.findMany({
      where: { group },
      orderBy: { name: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findByKey(group: string, name: string): Promise<ISettingData | null> {
    const record = await this.prisma.setting.findUnique({
      where: { group_name: { group, name } },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async upsert(
    group: string,
    name: string,
    data: IUpsertSettingData,
  ): Promise<ISettingData> {
    const record = await this.prisma.setting.upsert({
      where: { group_name: { group, name } },
      create: this.mapper.toCreate(group, name, data),
      update: this.mapper.toUpdate(data),
    });
    return this.mapper.toEntity(record);
  }

  async delete(group: string, name: string): Promise<void> {
    await this.prisma.setting.delete({
      where: { group_name: { group, name } },
    });
  }
}
