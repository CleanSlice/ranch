import { IPaddockEvaluationReportData } from './evaluation.types';

/**
 * Persists full eval reports (json + markdown) and per-scenario traces
 * to the paddock/ S3 prefix. Returns S3 keys for later retrieval.
 */
export abstract class IPaddockReportGateway {
  abstract saveReport(
    evaluationId: string,
    payload: IPaddockEvaluationReportData,
  ): Promise<string>;
  abstract loadReport(
    evaluationId: string,
    key: string,
  ): Promise<IPaddockEvaluationReportData | null>;
  abstract saveSnapshot(
    evaluationId: string,
    snapshot: object,
  ): Promise<string>;
  abstract saveTrace(
    evaluationId: string,
    scenarioId: string,
    trace: object,
  ): Promise<string>;
  abstract loadTrace(
    evaluationId: string,
    scenarioId: string,
  ): Promise<object | null>;
  abstract deleteForEvaluation(evaluationId: string): Promise<void>;
}
