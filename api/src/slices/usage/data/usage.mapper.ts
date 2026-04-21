import { Injectable } from '@nestjs/common';
import { Usage } from '@prisma/client';
import { IUsageData } from '../domain';

@Injectable()
export class UsageMapper {
  toEntity(record: Usage): IUsageData {
    return {
      id: record.id,
      agentId: record.agentId,
      llmCredentialId: record.llmCredentialId,
      model: record.model,
      date: record.date,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      callCount: record.callCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
