import { createServiceGetter } from '#common/composables/createServiceGetter';
import type {
  ICreatePaddockScenario,
  IGeneratePaddockScenario,
  IPaddockScenario,
  IUpdatePaddockScenario,
  PaddockScenarioService,
} from '#paddock/domain';

// Re-export the domain types so consumers importing them from
// `#paddock/stores/paddockScenario` keep working.
export type {
  ICreatePaddockScenario,
  IPaddockScenario,
  IPaddockScenarioMessage,
  IPaddockScenarioSetup,
  IPaddockSuccessCriterion,
  IUpdatePaddockScenario,
  PaddockEvalDimension,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from '#paddock/domain';

const getService = createServiceGetter<PaddockScenarioService>(
  '$paddockScenarioService',
);

export const usePaddockScenarioStore = defineStore('paddockScenario', () => {
  const scenarios = ref<IPaddockScenario[]>([]);

  async function fetchAll(filter: { templateId?: string; agentId?: string } = {}) {
    scenarios.value = await getService().findAll(filter);
    return scenarios.value;
  }

  function fetchById(id: string) {
    return getService().findById(id);
  }

  async function create(data: ICreatePaddockScenario) {
    const created = await getService().create(data);
    scenarios.value = [created, ...scenarios.value];
    return created;
  }

  async function update(id: string, data: IUpdatePaddockScenario) {
    const updated = await getService().update(id, data);
    scenarios.value = scenarios.value.map((s) => (s.id === id ? updated : s));
    return updated;
  }

  async function remove(id: string) {
    await getService().remove(id);
    scenarios.value = scenarios.value.filter((s) => s.id !== id);
  }

  function generate(
    input: IGeneratePaddockScenario,
  ): Promise<ICreatePaddockScenario> {
    return getService().generate(input);
  }

  return { scenarios, fetchAll, fetchById, create, update, remove, generate };
});
