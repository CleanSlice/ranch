import { Injectable } from '@nestjs/common';
import {
  PaddockEvaluation,
  PaddockEvaluationResult,
  Prisma,
} from '@prisma/client';
import {
  IPaddockEvaluationData,
  IPaddockEvaluationResultData,
  IPaddockJudgeConfig,
  IPaddockJudgeScoreData,
  PaddockEvaluationStatus,
  PaddockVerdict,
  ICreatePaddockEvaluationRecord,
} from '../domain';
import {
  IPaddockScenarioData,
  PaddockEvalDimension,
} from '../../scenario/domain';

type EvaluationWithResults = PaddockEvaluation & {
  results?: PaddockEvaluationResult[];
};

@Injectable()
export class PaddockEvaluationMapper {
  toEntity(record: EvaluationWithResults): IPaddockEvaluationData {
    return {
      id: record.id,
      agentId: record.agentId,
      templateId: record.templateId,
      status: record.status as PaddockEvaluationStatus,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      currentScenarioId: record.currentScenarioId,
      passRate: record.passRate,
      scenarioCount: record.scenarioCount,
      passCount: record.passCount,
      failCount: record.failCount,
      partialCount: record.partialCount,
      skippedCount: record.skippedCount,
      judgeConfig: record.judgeConfig as unknown as IPaddockJudgeConfig,
      scenariosSnapshot:
        record.scenariosSnapshot as unknown as IPaddockScenarioData[],
      scenarios: (
        record.scenariosSnapshot as unknown as IPaddockScenarioData[]
      ).map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        difficulty: s.difficulty,
      })),
      reportS3Key: record.reportS3Key,
      errorMessage: record.errorMessage,
      results: (record.results ?? []).map((r) => this.toResultEntity(r)),
    };
  }

  toResultEntity(record: PaddockEvaluationResult): IPaddockEvaluationResultData {
    return {
      id: record.id,
      evaluationId: record.evaluationId,
      scenarioId: record.scenarioId,
      verdict: record.verdict as PaddockVerdict,
      finalScore: record.finalScore,
      agreement: record.agreement,
      dimensionScores: record.dimensionScores as unknown as Partial<
        Record<PaddockEvalDimension, number>
      >,
      judges: record.judges as unknown as IPaddockJudgeScoreData[],
      failureReasons: record.failureReasons,
    };
  }

  toCreate(
    data: ICreatePaddockEvaluationRecord,
  ): Prisma.PaddockEvaluationUncheckedCreateInput {
    return {
      id: `evaluation-${crypto.randomUUID()}`,
      agentId: data.agentId,
      templateId: data.templateId,
      status: 'running',
      judgeConfig: data.judgeConfig as unknown as Prisma.InputJsonValue,
      scenariosSnapshot:
        data.scenariosSnapshot as unknown as Prisma.InputJsonValue,
      scenarioCount: data.scenariosSnapshot.length,
    };
  }

  toResultCreate(
    evaluationId: string,
    result: Omit<IPaddockEvaluationResultData, 'id' | 'evaluationId'>,
  ): Prisma.PaddockEvaluationResultUncheckedCreateInput {
    return {
      id: `evaluationResult-${crypto.randomUUID()}`,
      evaluationId,
      scenarioId: result.scenarioId,
      verdict: result.verdict,
      finalScore: result.finalScore,
      agreement: result.agreement,
      dimensionScores:
        result.dimensionScores as unknown as Prisma.InputJsonValue,
      judges: result.judges as unknown as Prisma.InputJsonValue,
      failureReasons: result.failureReasons,
    };
  }
}
