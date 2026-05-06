import { Injectable } from '@nestjs/common';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { IMcpServerGateway } from '../domain/mcpServer.gateway';
import {
  IMcpServerData,
  ICreateMcpServerData,
  IUpdateMcpServerData,
} from '../domain/mcpServer.types';
import { McpServerMapper } from './mcpServer.mapper';

@Injectable()
export class McpServerGateway extends IMcpServerGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: McpServerMapper,
  ) {
    super();
  }

  async findAll(): Promise<IMcpServerData[]> {
    const records = await this.prisma.mcpServer.findMany({
      orderBy: [{ builtIn: 'desc' }, { name: 'asc' }],
      include: { templates: { select: { id: true } } },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<IMcpServerData | null> {
    const record = await this.prisma.mcpServer.findUnique({
      where: { id },
      include: { templates: { select: { id: true } } },
    });
    return record ? this.mapper.toEntity(record) : null;
  }

  async findByIds(ids: string[]): Promise<IMcpServerData[]> {
    if (ids.length === 0) return [];
    const records = await this.prisma.mcpServer.findMany({
      where: { id: { in: ids } },
      include: { templates: { select: { id: true } } },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async create(data: ICreateMcpServerData): Promise<IMcpServerData> {
    const record = await this.prisma.mcpServer.create({
      data: this.mapper.toCreate(data),
      include: { templates: { select: { id: true } } },
    });
    return this.mapper.toEntity(record);
  }

  async update(
    id: string,
    data: IUpdateMcpServerData,
  ): Promise<IMcpServerData> {
    const record = await this.prisma.mcpServer.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.transport !== undefined && { transport: data.transport }),
        ...(data.authType !== undefined && { authType: data.authType }),
        ...(data.authValue !== undefined && { authValue: data.authValue }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
      },
      include: { templates: { select: { id: true } } },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.mcpServer.delete({ where: { id } });
  }
}
