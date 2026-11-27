import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  ISettingGateway,
  type ISettingWriteHook,
} from '../domain/setting.gateway';
import {
  applySettingOverrides,
  approvedSettingsFor,
  settingKeyOf,
  type ISettingWriter,
  type SettingOverrides,
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

  async liveVersions(): Promise<Map<string, Date>> {
    const records = await this.prisma.setting.findMany({
      select: { group: true, name: true, updatedAt: true },
    });
    return new Map(
      records.map((r) => [settingKeyOf(r.group, r.name), r.updatedAt]),
    );
  }

  // Every read answers in the state of the work it belongs to
  // (settingScope.ts): approved for the Ranch assistant, live for work that
  // said it is for somebody else, and approved again for work that said
  // nothing. This gateway is the one reader of settings, so nothing below
  // it can read past that.

  /**
   * One read of the settings table in the state of the current work.
   *
   * Live: `rows` is asked of the database and that is all.
   *
   * Approved (and undeclared): the rows and the approved values are read in
   * ONE transaction at REPEATABLE READ, which in Postgres is one snapshot
   * taken at its first statement. A write of a setting moves the row and
   * the approved value kept for it in one transaction (`writeBy`), so the
   * snapshot holds either both or neither, whatever commits while this
   * read is on its way. Two separate reads cannot promise that in either
   * order: the approved values first, and an Admin's write between the two
   * is answered with the Admin's row; the rows first, and an Admin's row
   * read just before the Admin put the old value back is answered with
   * nothing kept for it. Nothing is remembered between two reads either,
   * so no await of the caller's can stand between a write and the answer.
   * The transaction only reads and cannot fail on a conflict.
   */
  private async read<T>(
    key: string,
    rows: (db: Pick<PrismaService, 'setting'>) => Promise<T>,
  ): Promise<{ rows: T; overrides: SettingOverrides | null }> {
    const approved = approvedSettingsFor(key);
    if (!approved) return { rows: await rows(this.prisma), overrides: null };
    return this.prisma.$transaction(
      async (tx) => {
        const overrides = await approved.overrides(tx);
        return {
          rows: await rows(tx),
          overrides: overrides.size > 0 ? overrides : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async findAll(): Promise<ISettingData[]> {
    const { rows, overrides } = await this.read('*', (db) =>
      db.setting.findMany({ orderBy: [{ group: 'asc' }, { name: 'asc' }] }),
    );
    return applySettingOverrides(
      rows.map((r) => this.mapper.toEntity(r)),
      overrides,
    );
  }

  async findByGroup(group: string): Promise<ISettingData[]> {
    const { rows, overrides } = await this.read(`${group}.*`, (db) =>
      db.setting.findMany({ where: { group }, orderBy: { name: 'asc' } }),
    );
    return applySettingOverrides(
      rows.map((r) => this.mapper.toEntity(r)),
      overrides,
      group,
    );
  }

  async findByKey(group: string, name: string): Promise<ISettingData | null> {
    const key = settingKeyOf(group, name);
    const { rows: record, overrides } = await this.read(key, (db) =>
      db.setting.findUnique({ where: { group_name: { group, name } } }),
    );
    if (overrides?.has(key)) return overrides.get(key) ?? null;
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
