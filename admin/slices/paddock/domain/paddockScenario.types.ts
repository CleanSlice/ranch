// Domain types for paddock scenarios.

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

export interface IGeneratePaddockScenario {
  description: string;
  templateId?: string | null;
  agentId?: string | null;
  category?: PaddockScenarioCategory;
  difficulty?: PaddockScenarioDifficulty;
  credentialId?: string;
}
