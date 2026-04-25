import { Injectable } from '@nestjs/common';
import { Usage } from '@prisma/client';
import { IUsageData } from '../domain';

interface IUsageEntry {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  llmCredentialId?: string;
}

interface IUsageCreateInput {
  agentId: string;
  model: string;
  date: Date;
  entry: IUsageEntry;
}

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

  toCreate({ agentId, model, date, entry }: IUsageCreateInput) {
    return {
      id: `usage-${crypto.randomUUID()}`,
      agentId,
      model,
      date,
      llmCredentialId: entry.llmCredentialId ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      callCount: entry.callCount,
    };
  }

  toUpdate(entry: IUsageEntry) {
    return {
      llmCredentialId: entry.llmCredentialId ?? null,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      callCount: entry.callCount,
    };
  }
}
