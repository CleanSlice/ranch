import type { PaddockEvaluationService } from './domain/paddockEvaluation.service';
import type { PaddockScenarioService } from './domain/paddockScenario.service';

declare module '#app' {
  interface NuxtApp {
    $paddockEvaluationService: PaddockEvaluationService;
    $paddockScenarioService: PaddockScenarioService;
  }
}

export {};
