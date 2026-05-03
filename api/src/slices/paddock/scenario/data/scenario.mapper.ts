import { Injectable } from '@nestjs/common';
import { PaddockScenario, Prisma } from '@prisma/client';
import {
  IPaddockScenarioData,
  ICreatePaddockScenarioData,
  IPaddockScenarioMessage,
  IPaddockSuccessCriterion,
  IPaddockScenarioSetup,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from '../domain';

@Injectable()
export class PaddockScenarioMapper {
  toEntity(record: PaddockScenario): IPaddockScenarioData {
    return {
      id: record.id,
      templateId: record.templateId,
      agentId: record.agentId,
      category: record.category as PaddockScenarioCategory,
      difficulty: record.difficulty as PaddockScenarioDifficulty,
      name: record.name,
      description: record.description,
      expectedBehavior: record.expectedBehavior,
      messages: record.messages as unknown as IPaddockScenarioMessage[],
      successCriteria:
        record.successCriteria as unknown as IPaddockSuccessCriterion[],
      setup: (record.setup as unknown as IPaddockScenarioSetup | null) ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  toCreate(
    data: ICreatePaddockScenarioData,
  ): Prisma.PaddockScenarioUncheckedCreateInput {
    return {
      id: `scenario-${crypto.randomUUID()}`,
      templateId: data.templateId ?? null,
      agentId: data.agentId ?? null,
      category: data.category,
      difficulty: data.difficulty,
      name: data.name,
      description: data.description,
      expectedBehavior: data.expectedBehavior,
      messages: data.messages as unknown as Prisma.InputJsonValue,
      successCriteria: data.successCriteria as unknown as Prisma.InputJsonValue,
      setup: (data.setup ?? null) as unknown as Prisma.InputJsonValue,
    };
  }
}
