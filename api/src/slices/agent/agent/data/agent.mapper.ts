import { Injectable } from '@nestjs/common';
import { Agent, Prisma } from '@prisma/client';
import { IAgentData, ICreateAgentData } from '../domain';

@Injectable()
export class AgentMapper {
  toEntity(record: Agent): IAgentData {
    return {
      id: record.id,
      name: record.name,
      templateId: record.templateId,
      llmCredentialId: record.llmCredentialId,
      status: record.status as IAgentData['status'],
      workflowId: record.workflowId,
      config: record.config as unknown as Record<string, unknown>,
      resources: record.resources as unknown as IAgentData['resources'],
      debugEnabled: record.debugEnabled,
      isPublic: record.isPublic,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateAgentData) {
    return {
      id: `agent-${crypto.randomUUID()}`,
      name: data.name,
      templateId: data.templateId,
      llmCredentialId: data.llmCredentialId ?? null,
      status: 'pending',
      config: (data.config ?? {}) as unknown as Prisma.InputJsonValue,
      resources: (data.resources ?? {
        cpu: '500m',
        memory: '512Mi',
      }) as unknown as Prisma.InputJsonValue,
      isPublic: data.isPublic ?? false,
    };
  }
}
