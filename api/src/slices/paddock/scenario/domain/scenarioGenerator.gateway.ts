import {
  ICreatePaddockScenarioData,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from './scenario.types';

export interface IGeneratePaddockScenarioInput {
  description: string;
  templateId?: string | null;
  agentId?: string | null;
  category?: PaddockScenarioCategory;
  difficulty?: PaddockScenarioDifficulty;
  /** Optional LlmCredential id; if omitted, uses the first active credential. */
  credentialId?: string;
}

/**
 * Generates a Scenario draft from a natural-language description by calling
 * an LLM. The result is NOT persisted — caller reviews + saves separately.
 */
export abstract class IPaddockScenarioGeneratorGateway {
  abstract generate(
    input: IGeneratePaddockScenarioInput,
  ): Promise<ICreatePaddockScenarioData>;
}
