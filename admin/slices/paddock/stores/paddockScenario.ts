import { PaddockScenariosService } from '#api/data';

type ApiEnvelope<T> = { success: boolean; data: T };

export type PaddockScenarioCategory =
  | 'tool_use'
  | 'memory'
  | 'conversation'
  | 'patching_workflow'
  | 'edge_case'
  | 'multi_turn'
  | 'error_recovery';

export type PaddockScenarioDifficulty =
  | 'easy'
  | 'medium'
  | 'hard'
  | 'adversarial';

export type PaddockEvalDimension =
  | 'correctness'
  | 'tool_usage'
  | 'soul_compliance'
  | 'response_quality'
  | 'error_handling';

export interface IPaddockScenarioMessage {
  text: string;
  from: string;
  delayMs?: number;
}

export interface IPaddockSuccessCriterion {
  dimension: PaddockEvalDimension;
  description: string;
  weight: number;
}

export interface IPaddockScenarioSetup {
  files?: Record<string, string>;
  env?: Record<string, string>;
  tools?: string[];
}

export interface IPaddockScenario {
  id: string;
  templateId: string | null;
  agentId: string | null;
  category: PaddockScenarioCategory;
  difficulty: PaddockScenarioDifficulty;
  name: string;
  description: string;
  expectedBehavior: string;
  messages: IPaddockScenarioMessage[];
  successCriteria: IPaddockSuccessCriterion[];
  setup: IPaddockScenarioSetup | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICreatePaddockScenario {
  templateId?: string | null;
  agentId?: string | null;
  category: PaddockScenarioCategory;
  difficulty: PaddockScenarioDifficulty;
  name: string;
  description: string;
  expectedBehavior: string;
  messages: IPaddockScenarioMessage[];
  successCriteria: IPaddockSuccessCriterion[];
  setup?: IPaddockScenarioSetup | null;
}

export interface IUpdatePaddockScenario {
  category?: PaddockScenarioCategory;
  difficulty?: PaddockScenarioDifficulty;
  name?: string;
  description?: string;
  expectedBehavior?: string;
  messages?: IPaddockScenarioMessage[];
  successCriteria?: IPaddockSuccessCriterion[];
  setup?: IPaddockScenarioSetup | null;
}

export const usePaddockScenarioStore = defineStore('paddockScenario', () => {
  const scenarios = ref<IPaddockScenario[]>([]);

  async function fetchAll(filter: { templateId?: string; agentId?: string } = {}) {
    const res = await PaddockScenariosService.paddockScenarioControllerFindAll({
      query: filter,
    });
    const env = res.data as ApiEnvelope<IPaddockScenario[]> | undefined;
    scenarios.value = env?.data ?? [];
    return scenarios.value;
  }

  async function fetchById(id: string) {
    const res = await PaddockScenariosService.paddockScenarioControllerFindById({
      path: { id },
    });
    const env = res.data as ApiEnvelope<IPaddockScenario | null> | undefined;
    return env?.data ?? null;
  }

  async function create(data: ICreatePaddockScenario) {
    const res = await PaddockScenariosService.paddockScenarioControllerCreate({
      body: data,
    });
    const env = res.data as ApiEnvelope<IPaddockScenario>;
    scenarios.value = [env.data, ...scenarios.value];
    return env.data;
  }

  async function update(id: string, data: IUpdatePaddockScenario) {
    const res = await PaddockScenariosService.paddockScenarioControllerUpdate({
      path: { id },
      body: data,
    });
    const env = res.data as ApiEnvelope<IPaddockScenario>;
    scenarios.value = scenarios.value.map((s) => (s.id === id ? env.data : s));
    return env.data;
  }

  async function remove(id: string) {
    const res = await PaddockScenariosService.paddockScenarioControllerRemove({
      path: { id },
    });
    if (res.error) {
      const err = res.error as { message?: string };
      throw new Error(err.message ?? 'Failed to delete scenario');
    }
    scenarios.value = scenarios.value.filter((s) => s.id !== id);
  }

  async function generate(input: {
    description: string;
    templateId?: string | null;
    agentId?: string | null;
    category?: PaddockScenarioCategory;
    difficulty?: PaddockScenarioDifficulty;
    credentialId?: string;
  }): Promise<ICreatePaddockScenario> {
    const res =
      await PaddockScenariosService.paddockScenarioControllerGenerate({
        body: input,
      });
    const env = res.data as ApiEnvelope<ICreatePaddockScenario> | undefined;
    if (!env) {
      const err = res.error as { message?: string } | undefined;
      throw new Error(err?.message ?? 'Failed to generate scenario');
    }
    return env.data;
  }

  return { scenarios, fetchAll, fetchById, create, update, remove, generate };
});
