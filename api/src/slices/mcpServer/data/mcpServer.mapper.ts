import { Injectable } from '@nestjs/common';
import { McpServer } from '@prisma/client';
import {
  IMcpServerData,
  ICreateMcpServerData,
  McpServerAuthTypes,
  McpServerTransportTypes,
} from '../domain';

type McpServerWithTemplates = McpServer & { templates?: { id: string }[] };

@Injectable()
export class McpServerMapper {
  toEntity(record: McpServerWithTemplates): IMcpServerData {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      url: record.url,
      transport: record.transport as McpServerTransportTypes,
      authType: record.authType as McpServerAuthTypes,
      authValue: record.authValue,
      enabled: record.enabled,
      builtIn: record.builtIn,
      templateIds: (record.templates ?? []).map((t) => t.id),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateMcpServerData) {
    return {
      id: data.id ?? `mcp-${crypto.randomUUID()}`,
      name: data.name,
      description: data.description ?? null,
      url: data.url,
      transport: data.transport ?? 'streamableHttp',
      authType: data.authType ?? 'none',
      authValue: data.authValue ?? null,
      enabled: data.enabled ?? true,
      builtIn: data.builtIn ?? false,
    };
  }
}
