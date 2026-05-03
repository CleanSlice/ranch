import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IAgentGateway } from '../domain/agent.gateway';
import {
  IAgentData,
  ICreateAgentData,
  IUpdateAgentData,
  AgentStatusTypes,
} from '../domain/agent.types';
import { AgentMapper } from './agent.mapper';

@Injectable()
export class AgentGateway extends IAgentGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: AgentMapper,
  ) {
    super();
  }

  async findAll(): Promise<IAgentData[]> {
    const records = await this.prisma.agent.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findPublic(): Promise<IAgentData[]> {
    const records = await this.prisma.agent.findMany({
      where: { isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findAdmin(): Promise<IAgentData | null> {
    const record = await this.prisma.agent.findFirst({
      where: { isAdmin: true },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findById(id: string): Promise<IAgentData | null> {
    const record = await this.prisma.agent.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateAgentData): Promise<IAgentData> {
    const record = await this.prisma.agent.create({
      data: this.mapper.toCreate(data),
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateAgentData): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.llmCredentialId !== undefined && {
          llmCredentialId: data.llmCredentialId,
        }),
        ...(data.config && {
          config: data.config as unknown as Prisma.InputJsonValue,
        }),
        ...(data.resources && {
          resources: data.resources as unknown as Prisma.InputJsonValue,
        }),
        ...(data.isPublic !== undefined && { isPublic: data.isPublic }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async updateStatus(
    id: string,
    status: AgentStatusTypes,
    workflowId?: string,
  ): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: {
        status,
        ...(workflowId && { workflowId }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async setWorkflowId(id: string, workflowId: string): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: { workflowId },
    });
    return this.mapper.toEntity(record);
  }

  async setDebugEnabled(id: string, enabled: boolean): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: { debugEnabled: enabled },
    });
    return this.mapper.toEntity(record);
  }

  async setAdmin(id: string, enabled: boolean): Promise<IAgentData> {
    if (!enabled) {
      const record = await this.prisma.agent.update({
        where: { id },
        data: { isAdmin: false },
      });
      return this.mapper.toEntity(record);
    }
    // Single-admin invariant — clear the flag from any other agent first.
    const [, record] = await this.prisma.$transaction([
      this.prisma.agent.updateMany({
        where: { isAdmin: true, NOT: { id } },
        data: { isAdmin: false },
      }),
      this.prisma.agent.update({
        where: { id },
        data: { isAdmin: true },
      }),
    ]);
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.agent.delete({ where: { id } });
  }
}
