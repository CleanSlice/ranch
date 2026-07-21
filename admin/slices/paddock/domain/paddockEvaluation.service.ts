import type { IPaddockEvaluationGateway } from './paddockEvaluation.gateway';
import type {
  IPaddockEvaluation,
  IPaddockEvaluationFilter,
  IPaddockEvaluationReport,
  IRunPaddockEvaluation,
} from './paddockEvaluation.types';

/** Domain service for paddock evaluations. The store layers the reactive list. */
export class PaddockEvaluationService {
  constructor(private gateway: IPaddockEvaluationGateway) {}

  list(filter: IPaddockEvaluationFilter): Promise<IPaddockEvaluation[]> {
    return this.gateway.list(filter);
  }

  get(id: string): Promise<IPaddockEvaluation | null> {
    return this.gateway.get(id);
  }

  start(input: IRunPaddockEvaluation): Promise<IPaddockEvaluation> {
    return this.gateway.start(input);
  }

  abort(id: string): Promise<IPaddockEvaluation> {
    return this.gateway.abort(id);
  }

  rerun(id: string): Promise<IPaddockEvaluation> {
    return this.gateway.rerun(id);
  }

  report(id: string): Promise<IPaddockEvaluationReport> {
    return this.gateway.report(id);
  }

  trace(id: string, scenarioId: string): Promise<object | null> {
    return this.gateway.trace(id, scenarioId);
  }

  logs(id: string): Promise<string[]> {
    return this.gateway.logs(id);
  }

  evalScenario(id: string, scenarioId: string): Promise<unknown | null> {
    return this.gateway.evalScenario(id, scenarioId);
  }
}
