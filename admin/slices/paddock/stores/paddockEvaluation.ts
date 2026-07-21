import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  IPaddockEvaluation,
  IPaddockEvaluationReport,
  IRunPaddockEvaluation,
  PaddockEvaluationService,
} from '#paddock/domain';

// Re-export the domain types so consumers importing them from
// `#paddock/stores/paddockEvaluation` keep working.
export type {
  IPaddockEvaluation,
  IPaddockEvaluationResult,
  IPaddockEvaluationScenarioSummary,
  IPaddockJudgeConfig,
  IPaddockJudgeScore,
  IRunPaddockEvaluation,
  PaddockEvaluationStatus,
  PaddockVerdict,
} from '#paddock/domain';

const getService = createServiceGetter<PaddockEvaluationService>(
  '$paddockEvaluationService',
);

export const usePaddockEvaluationStore = defineStore(
  'paddockEvaluation',
  () => {
    const evaluations = ref<IPaddockEvaluation[]>([]);

    async function fetchAll(
      filter: { agentId?: string; templateId?: string; limit?: number } = {},
    ) {
      evaluations.value = await getService().list(filter);
      return evaluations.value;
    }

    function fetchById(id: string) {
      return getService().get(id);
    }

    async function start(input: IRunPaddockEvaluation) {
      const created = await getService().start(input);
      evaluations.value = [created, ...evaluations.value];
      return created;
    }

    async function abort(id: string) {
      const updated = await getService().abort(id);
      evaluations.value = evaluations.value.map((e) =>
        e.id === id ? updated : e,
      );
      return updated;
    }

    async function rerun(id: string): Promise<IPaddockEvaluation> {
      const created = await getService().rerun(id);
      evaluations.value = [created, ...evaluations.value];
      return created;
    }

    function fetchReport(id: string): Promise<IPaddockEvaluationReport> {
      return getService().report(id);
    }

    function fetchTrace(id: string, scenarioId: string): Promise<object | null> {
      return getService().trace(id, scenarioId);
    }

    function fetchLogs(id: string): Promise<string[]> {
      return getService().logs(id);
    }

    // Fetch a scenario from the evaluation's snapshot — survives template
    // re-seeds that change scenario UUIDs in the live table.
    function fetchEvalScenario(
      id: string,
      scenarioId: string,
    ): Promise<unknown | null> {
      return getService().evalScenario(id, scenarioId);
    }

    return {
      evaluations,
      fetchAll,
      fetchById,
      start,
      abort,
      rerun,
      fetchReport,
      fetchTrace,
      fetchLogs,
      fetchEvalScenario,
    };
  },
);
