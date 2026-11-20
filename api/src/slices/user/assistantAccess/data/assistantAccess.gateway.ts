import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import {
  IAssistantAccessGateway,
  IAssistantSettingWrite,
} from '../domain/assistantAccess.gateway';
import type {
  AssistantRole,
  IAssistantAccountData,
  IAssistantSettingData,
} from '../domain/assistantAccess.types';
import { AssistantAccessMapper } from './assistantAccess.mapper';

@Injectable()
export class AssistantAccessGateway extends IAssistantAccessGateway {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: AssistantAccessMapper,
  ) {
    super();
  }

  async findRole(role: AssistantRole): Promise<IAssistantSettingData | null> {
    const row = await this.prisma.assistantRoleAccess.findUnique({
      where: { role },
    });
    return row ? this.mapper.toSetting(row) : null;
  }

  async saveRole(
    role: AssistantRole,
    data: IAssistantSettingWrite,
  ): Promise<IAssistantSettingData> {
    const values = this.values(data);
    const row = await this.prisma.assistantRoleAccess.upsert({
      where: { role },
      create: { role, ...values },
      update: values,
    });
    return this.mapper.toSetting(row);
  }

  async findAccount(userId: string): Promise<IAssistantAccountData | null> {
    const row = await this.prisma.assistantAccountAccess.findUnique({
      where: { userId },
    });
    return row ? this.mapper.toAccount(row) : null;
  }

  async listAccounts(): Promise<IAssistantAccountData[]> {
    const rows = await this.prisma.assistantAccountAccess.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.mapper.toAccount(row));
  }

  async saveAccount(
    userId: string,
    data: IAssistantSettingWrite,
  ): Promise<IAssistantAccountData> {
    const values = this.values(data);
    const row = await this.prisma.assistantAccountAccess.upsert({
      where: { userId },
      create: { userId, ...values },
      update: values,
    });
    return this.mapper.toAccount(row);
  }

  async deleteAccount(userId: string): Promise<boolean> {
    const { count } = await this.prisma.assistantAccountAccess.deleteMany({
      where: { userId },
    });
    return count > 0;
  }

  private values(data: IAssistantSettingWrite) {
    return {
      enabled: data.enabled,
      level: data.level,
      // Prisma tells "set the column to SQL NULL" from "leave it" by this
      // marker; a plain `null` is not accepted for a Json column.
      custom: data.custom
        ? (data.custom as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      updatedById: data.updatedById,
    };
  }
}
