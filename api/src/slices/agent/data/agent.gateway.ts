import { Injectable } from '@nestjs/common';
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

  async findById(id: string): Promise<IAgentData | null> {
    const record = await this.prisma.agent.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateAgentData): Promise<IAgentData> {
    const record = await this.prisma.agent.create({
      data: {
        name: data.name,
        templateId: data.templateId,
        status: 'pending',
        config: data.config ?? {},
        resources: data.resources ?? { cpu: '500m', memory: '512Mi' },
      },
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateAgentData): Promise<IAgentData> {
    const record = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.config && { config: data.config }),
        ...(data.resources && { resources: data.resources }),
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

  async delete(id: string): Promise<void> {
    await this.prisma.agent.delete({ where: { id } });
  }
}
