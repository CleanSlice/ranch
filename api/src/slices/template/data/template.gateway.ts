import { Injectable } from '@nestjs/common';
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
        defaultConfig: data.defaultConfig ?? {},
        defaultResources: data.defaultResources ?? {
          cpu: '500m',
          memory: '512Mi',
        },
      },
    });
    return this.mapper.toEntity(record);
  }

  async update(id: string, data: IUpdateTemplateData): Promise<ITemplateData> {
    const record = await this.prisma.template.update({
      where: { id },
      data,
    });
    return this.mapper.toEntity(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.template.delete({ where: { id } });
  }
}
