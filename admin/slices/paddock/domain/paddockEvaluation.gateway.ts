import type {
  IPaddockEvaluation,
  IPaddockEvaluationFilter,
  IPaddockEvaluationReport,
  IRunPaddockEvaluation,
} from './paddockEvaluation.types';

/** Contract for paddock evaluations. Implemented by `PaddockEvaluationGateway`. */
export abstract class IPaddockEvaluationGateway {
  abstract list(filter: IPaddockEvaluationFilter): Promise<IPaddockEvaluation[]>;
  abstract get(id: string): Promise<IPaddockEvaluation | null>;
  abstract start(input: IRunPaddockEvaluation): Promise<IPaddockEvaluation>;
  abstract abort(id: string): Promise<IPaddockEvaluation>;
  abstract rerun(id: string): Promise<IPaddockEvaluation>;
  abstract report(id: string): Promise<IPaddockEvaluationReport>;
  abstract trace(id: string, scenarioId: string): Promise<object | null>;
  abstract logs(id: string): Promise<string[]>;
  abstract evalScenario(id: string, scenarioId: string): Promise<unknown | null>;
}
