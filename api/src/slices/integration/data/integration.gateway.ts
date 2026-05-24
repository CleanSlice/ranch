import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma';
import { IIntegrationGateway } from '../domain/integration.gateway';
import {
  IIntegrationAccountData,
  ICreateIntegrationAccountData,
  IUpdateIntegrationAccountData,
} from '../domain/integration.types';
import { IntegrationMapper } from './integration.mapper';

@Injectable()
export class IntegrationGateway extends IIntegrationGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: IntegrationMapper,
  ) {
    super();
  }

  async findAll(userId: string): Promise<IIntegrationAccountData[]> {
    const records = await this.prisma.integrationAccount.findMany({
      where: { userId },
      orderBy: [{ service: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(
    userId: string,
    id: string,
  ): Promise<IIntegrationAccountData | null> {
    const record = await this.prisma.integrationAccount.findFirst({
      where: { id, userId },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByServiceAccount(
    userId: string,
    service: string,
    accountKey: string,
  ): Promise<IIntegrationAccountData | null> {
    const record = await this.prisma.integrationAccount.findUnique({
      where: {
        userId_service_accountKey: { userId, service, accountKey },
      },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findGlobal(service?: string): Promise<IIntegrationAccountData[]> {
    const records = await this.prisma.integrationAccount.findMany({
      where: service ? { service } : {},
      orderBy: [{ service: 'asc' }, { updatedAt: 'desc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async create(
    data: ICreateIntegrationAccountData,
  ): Promise<IIntegrationAccountData> {
    const record = await this.prisma.integrationAccount.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async update(
    userId: string,
    id: string,
    data: IUpdateIntegrationAccountData,
  ): Promise<IIntegrationAccountData> {
    // Scope-check first so we never update someone else's row by ID guess.
    await this.requireOwned(userId, id);
    const record = await this.prisma.integrationAccount.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.requireOwned(userId, id);
    await this.prisma.integrationAccount.delete({ where: { id } });
  }

  private async requireOwned(userId: string, id: string): Promise<void> {
    const exists = await this.prisma.integrationAccount.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Integration account not found');
  }
}
