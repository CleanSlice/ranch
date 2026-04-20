import { Injectable } from '@nestjs/common';
import { Template } from '@prisma/client';
import { ITemplateData } from '../domain';

@Injectable()
export class TemplateMapper {
  toEntity(record: Template): ITemplateData {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      image: record.image,
      defaultConfig: record.defaultConfig as unknown as Record<string, unknown>,
      defaultResources: record.defaultResources as unknown as ITemplateData['defaultResources'],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
