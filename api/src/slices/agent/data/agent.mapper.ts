import { Injectable } from '@nestjs/common';
import { Agent } from '@prisma/client';
import { IAgentData } from '../domain';

@Injectable()
export class AgentMapper {
  toEntity(record: Agent): IAgentData {
    return {
      id: record.id,
      name: record.name,
      templateId: record.templateId,
      status: record.status as IAgentData['status'],
      workflowId: record.workflowId,
      config: record.config as Record<string, unknown>,
      resources: record.resources as IAgentData['resources'],
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
