import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ILlmGateway } from '../domain/llm.gateway';
import {
  ILlmCredentialData,
  ICreateLlmCredentialData,
  IUpdateLlmCredentialData,
} from '../domain/llm.types';
import { LlmMapper } from './llm.mapper';

@Injectable()
export class LlmGateway extends ILlmGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: LlmMapper,
  ) {
    super();
  }

  async findAll(): Promise<ILlmCredentialData[]> {
    const records = await this.prisma.llmCredential.findMany({
      orderBy: [{ status: 'asc' }, { provider: 'asc' }, { model: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findActive(): Promise<ILlmCredentialData[]> {
    const records = await this.prisma.llmCredential.findMany({
      where: { status: 'active' },
      orderBy: [{ provider: 'asc' }, { model: 'asc' }],
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ILlmCredentialData | null> {
    const record = await this.prisma.llmCredential.findUnique({
      where: { id },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(
    data: ICreateLlmCredentialData,
  ): Promise<ILlmCredentialData> {
    const record = await this.prisma.llmCredential.create({
      data: {
        provider: data.provider,
        model: data.model,
        fallbackModel: data.fallbackModel ?? null,
        apiKey: data.apiKey,
        label: data.label ?? null,
        status: data.status ?? 'active',
      },
    });
    return this.mapper.toEntity(record);
  }

  async update(
    id: string,
    data: IUpdateLlmCredentialData,
  ): Promise<ILlmCredentialData> {
    const record = await this.prisma.llmCredential.update({
      where: { id },
      data,
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.llmCredential.delete({ where: { id } });
  }
}
