import { Injectable } from '@nestjs/common';
import { Template, Prisma } from '@prisma/client';
import { ITemplateData, ICreateTemplateData } from '../domain';

type TemplateWithRelations = Template & {
  skills?: { id: string }[];
  mcpServers?: { id: string }[];
};

@Injectable()
export class TemplateMapper {
  toEntity(record: TemplateWithRelations): ITemplateData {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      image: record.image,
      defaultConfig: record.defaultConfig as unknown as Record<string, unknown>,
      defaultResources:
        record.defaultResources as unknown as ITemplateData['defaultResources'],
      paddockConfig:
        (record.paddockConfig as unknown as Record<string, unknown>) ?? {},
      sourceUrl: record.sourceUrl,
      sourceType: record.sourceType,
      manifestJson:
        (record.manifestJson as unknown as Record<string, unknown> | null) ??
        null,
      version: record.version,
      skillIds: (record.skills ?? []).map((s) => s.id),
      mcpServerIds: (record.mcpServers ?? []).map((m) => m.id),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateTemplateData) {
    return {
      id: `template-${crypto.randomUUID()}`,
      name: data.name,
      description: data.description,
      image: data.image,
      defaultConfig: (data.defaultConfig ??
        {}) as unknown as Prisma.InputJsonValue,
      defaultResources: (data.defaultResources ?? {
        cpu: '500m',
        memory: '512Mi',
      }) as unknown as Prisma.InputJsonValue,
      ...(data.paddockConfig !== undefined && {
        paddockConfig: data.paddockConfig as unknown as Prisma.InputJsonValue,
      }),
      ...(data.sourceUrl !== undefined && { sourceUrl: data.sourceUrl }),
      ...(data.sourceType !== undefined && { sourceType: data.sourceType }),
      ...(data.manifestJson !== undefined && {
        manifestJson: data.manifestJson as unknown as Prisma.InputJsonValue,
      }),
      ...(data.version !== undefined && { version: data.version }),
    };
  }
}
