import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';
import { ITemplateGateway } from '../domain/template.gateway';
import {
  ITemplateData,
  ICreateTemplateData,
  IUpdateTemplateData,
} from '../domain/template.types';
import { TemplateMapper } from './template.mapper';

@Injectable()
export class TemplateGateway extends ITemplateGateway {
  constructor(
    private prisma: PrismaService,
    private mapper: TemplateMapper,
  ) {
    super();
  }

  async findAll(): Promise<ITemplateData[]> {
    const records = await this.prisma.template.findMany({
      orderBy: { name: 'asc' },
    });
    return records.map((r) => this.mapper.toEntity(r));
  }

  async findById(id: string): Promise<ITemplateData | null> {
    const record = await this.prisma.template.findUnique({ where: { id } });
    return record ? this.mapper.toEntity(record) : null;
  }

  async create(data: ICreateTemplateData): Promise<ITemplateData> {
    const record = await this.prisma.template.create({
      data: {
        name: data.name,
        description: data.description,
        image: data.image,
        defaultConfig: (data.defaultConfig ??
          {}) as unknown as Prisma.InputJsonValue,
        defaultResources: (data.defaultResources ?? {
          cpu: '500m',
          memory: '512Mi',
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateTemplateData): Promise<ITemplateData> {
    const record = await this.prisma.template.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.description && { description: data.description }),
        ...(data.image && { image: data.image }),
        ...(data.defaultConfig && {
          defaultConfig:
            data.defaultConfig as unknown as Prisma.InputJsonValue,
        }),
        ...(data.defaultResources && {
          defaultResources:
            data.defaultResources as unknown as Prisma.InputJsonValue,
        }),
      },
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.template.delete({ where: { id } });
  }
}
