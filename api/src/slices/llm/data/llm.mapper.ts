import { Injectable } from '@nestjs/common';
import { LlmCredential } from '@prisma/client';
import { ILlmCredentialData, ICreateLlmCredentialData } from '../domain';

@Injectable()
export class LlmMapper {
  toEntity(record: LlmCredential): ILlmCredentialData {
    return {
      id: record.id,
      provider: record.provider,
      model: record.model,
      fallbackModel: record.fallbackModel,
      label: record.label,
      apiKey: record.apiKey,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(data: ICreateLlmCredentialData) {
    return {
      id: `llm-${crypto.randomUUID()}`,
      provider: data.provider,
      model: data.model,
      fallbackModel: data.fallbackModel ?? null,
      apiKey: data.apiKey,
      label: data.label ?? null,
      status: data.status ?? 'active',
    };
  }
}
