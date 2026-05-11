import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IApiKeyGateway } from '../domain/apiKey.gateway';
import { IApiKeyData, ICreateApiKeyData } from '../domain/apiKey.types';
import { ApiKeyMapper } from './apiKey.mapper';

@Injectable()
export class ApiKeyGateway extends IApiKeyGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: ApiKeyMapper,
  ) {
    super();
  }

  async findAll(): Promise<IApiKeyData[]> {
    const records = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<IApiKeyData | null> {
    const record = await this.prisma.apiKey.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByHash(keyHash: string): Promise<IApiKeyData | null> {
    const record = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(
    data: ICreateApiKeyData & { keyHash: string; prefix: string },
  ): Promise<IApiKeyData> {
    const record = await this.prisma.apiKey.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.apiKey.delete({ where: { id } });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
