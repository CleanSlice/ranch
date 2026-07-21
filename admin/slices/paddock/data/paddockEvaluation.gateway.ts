import { PaddockEvaluationsService } from '#api/data';
import { client as apiClient } from '#api/data/repositories/api/client.gen';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IPaddockEvaluationGateway } from '../domain/paddockEvaluation.gateway';
import type {
  IPaddockEvaluation,
  IPaddockEvaluationFilter,
  IPaddockEvaluationReport,
  IRunPaddockEvaluation,
} from '../domain/paddockEvaluation.types';
import { PaddockEvaluationMapper } from './paddockEvaluation.mapper';

export class PaddockEvaluationGateway
  extends BaseGateway
  implements IPaddockEvaluationGateway
{
  private mapper = new PaddockEvaluationMapper();

  list(filter: IPaddockEvaluationFilter): Promise<IPaddockEvaluation[]> {
    return this.execute(async () => {
      const res = await PaddockEvaluationsService.paddockEvaluationControllerList({
        query: {
          agentId: filter.agentId,
          templateId: filter.templateId,
          limit: filter.limit?.toString(),
        },
      });
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  get(id: string): Promise<IPaddockEvaluation | null> {
    return this.execute(async () => {
      const res = await PaddockEvaluationsService.paddockEvaluationControllerGet({
        path: { id },
      });
      return this.mapper.toEvaluation(unwrapEnvelope(res.data));
    });
  }

  start(input: IRunPaddockEvaluation): Promise<IPaddockEvaluation> {
    return this.execute(async () => {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerStart({
          body: input,
        });
      return this.evaluationOrThrow(res, 'Start evaluation');
    });
  }

  abort(id: string): Promise<IPaddockEvaluation> {
    return this.execute(async () => {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerAbort({
          path: { id },
        });
      return this.evaluationOrThrow(res, 'Abort evaluation');
    });
  }

  rerun(id: string): Promise<IPaddockEvaluation> {
    return this.execute(async () => {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerRerun({
          path: { id },
        });
      return this.evaluationOrThrow(res, 'Failed to rerun evaluation');
    });
  }

  report(id: string): Promise<IPaddockEvaluationReport> {
    return this.execute(async () => {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerReport({
          path: { id },
        });
      const report = this.mapper.toReport(unwrapEnvelope(res.data));
      if (!report) throw new Error('Report not available');
      return report;
    });
  }

  trace(id: string, scenarioId: string): Promise<object | null> {
    return this.execute(async () => {
      const res =
        await PaddockEvaluationsService.paddockEvaluationControllerTrace({
          path: { id },
          query: { scenarioId },
        });
      const data = unwrapEnvelope<object>(res.data);
      return data ?? null;
    });
  }

  // Raw client: these routes were added without regenerating the SDK.
  logs(id: string): Promise<string[]> {
    return this.execute(async () => {
      const res = await apiClient.get({
        url: `/paddock-evaluations/${id}/logs`,
      });
      const data = unwrapEnvelope<{ lines?: string[] }>(res.data);
      return Array.isArray(data?.lines) ? data.lines : [];
    });
  }

  evalScenario(id: string, scenarioId: string): Promise<unknown | null> {
    return this.execute(async () => {
      try {
        const res = await apiClient.get({
          url: `/paddock-evaluations/${id}/scenarios/${scenarioId}`,
        });
        return unwrapEnvelope(res.data);
      } catch {
        return null;
      }
    });
  }

  private evaluationOrThrow(
    res: { data?: unknown; error?: unknown },
    action: string,
  ): IPaddockEvaluation {
    const evaluation = this.mapper.toEvaluation(unwrapEnvelope(res.data));
    if (evaluation) return evaluation;
    const err = res.error as { message?: string } | undefined;
    throw new Error(err?.message ?? `${action} returned no data`);
  }
}
