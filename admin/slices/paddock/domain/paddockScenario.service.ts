import type { IPaddockScenarioGateway } from './paddockScenario.gateway';
import type {
  ICreatePaddockScenario,
  IGeneratePaddockScenario,
  IPaddockScenario,
  IUpdatePaddockScenario,
} from './paddockScenario.types';

/** Domain service for paddock scenarios. The store layers the reactive list. */
export class PaddockScenarioService {
  constructor(private gateway: IPaddockScenarioGateway) {}

  findAll(filter: {
    templateId?: string;
    agentId?: string;
  }): Promise<IPaddockScenario[]> {
    return this.gateway.findAll(filter);
  }

  findById(id: string): Promise<IPaddockScenario | null> {
    return this.gateway.findById(id);
  }

  create(input: ICreatePaddockScenario): Promise<IPaddockScenario> {
    return this.gateway.create(input);
  }

  update(
    id: string,
    input: IUpdatePaddockScenario,
  ): Promise<IPaddockScenario> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }

  generate(input: IGeneratePaddockScenario): Promise<ICreatePaddockScenario> {
    return this.gateway.generate(input);
  }
}
