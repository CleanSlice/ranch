import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ISettingGateway,
  type ISettingWriteHook,
} from '../domain/setting.gateway';
import {
  applySettingOverrides,
  overriddenSetting,
  type ISettingWriter,
} from '../domain/settingScope';
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

  private writeHook: ISettingWriteHook | null = null;

  attachWriteHook(hook: ISettingWriteHook): void {
    this.writeHook = hook;
  }

  // Every read answers through the scope of the work it belongs to
  // (settingScope.ts): the Ranch assistant is served the values the Owner
  // approved, everybody else the live ones. This gateway is the one reader
  // of settings, so nothing below it can read past the scope.

  async findAll(): Promise<ISettingData[]> {
    const records = await this.prisma.setting.findMany({
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
    });
    return applySettingOverrides(records.map((r) => this.mapper.toEntity(r)));
  }

  async findByGroup(group: string): Promise<ISettingData[]> {
    const records = await this.prisma.setting.findMany({
      where: { group },
      orderBy: { name: 'asc' },
    });
    return applySettingOverrides(
      records.map((r) => this.mapper.toEntity(r)),
      group,
    );
  }

  async findByKey(group: string, name: string): Promise<ISettingData | null> {
    const approved = overriddenSetting(group, name);
    if (approved !== undefined) return approved;
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

  async writeBy(
    group: string,
    name: string,
    data: IUpsertSettingData | null,
    by: ISettingWriter,
  ): Promise<ISettingData | null> {
    const hook = this.writeHook;
    const where = { group_name: { group, name } };
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.setting.findUnique({ where });
      const record =
        data === null
          ? (await tx.setting.delete({ where }), null)
          : await tx.setting.upsert({
              where,
              create: this.mapper.toCreate(group, name, data),
              update: this.mapper.toUpdate(data),
            });
      if (hook) {
        await hook.onWrite(tx, {
          group,
          name,
          before: before && {
            valueType: before.valueType,
            value: before.value,
          },
          after: record && { valueType: record.valueType, value: record.value },
          by,
        });
      }
      return record ? this.mapper.toEntity(record) : null;
    });
  }
}
