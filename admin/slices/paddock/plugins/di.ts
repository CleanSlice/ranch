import { PaddockEvaluationGateway } from '../data/paddockEvaluation.gateway';
import { PaddockScenarioGateway } from '../data/paddockScenario.gateway';
import { PaddockEvaluationService } from '../domain/paddockEvaluation.service';
import { PaddockScenarioService } from '../domain/paddockScenario.service';

/**
 * Composition root for the paddock slice. Provides both services:
 * `$paddockEvaluationService` and `$paddockScenarioService`.
 */
export default defineNuxtPlugin({
  name: 'paddock-di',
  setup() {
    const evaluationService = new PaddockEvaluationService(
      new PaddockEvaluationGateway(),
    );
    const scenarioService = new PaddockScenarioService(
      new PaddockScenarioGateway(),
    );
    return {
      provide: {
        paddockEvaluationService: evaluationService,
        paddockScenarioService: scenarioService,
      },
    };
  },
});
