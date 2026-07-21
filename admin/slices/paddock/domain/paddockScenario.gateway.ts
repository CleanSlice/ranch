import type {
  ICreatePaddockScenario,
  IGeneratePaddockScenario,
  IPaddockScenario,
  IUpdatePaddockScenario,
} from './paddockScenario.types';

/** Contract for paddock scenarios. Implemented by `PaddockScenarioGateway`. */
export abstract class IPaddockScenarioGateway {
  abstract findAll(filter: {
    templateId?: string;
    agentId?: string;
  }): Promise<IPaddockScenario[]>;
  abstract findById(id: string): Promise<IPaddockScenario | null>;
  abstract create(input: ICreatePaddockScenario): Promise<IPaddockScenario>;
  abstract update(
    id: string,
    input: IUpdatePaddockScenario,
  ): Promise<IPaddockScenario>;
  abstract remove(id: string): Promise<void>;
  abstract generate(
    input: IGeneratePaddockScenario,
  ): Promise<ICreatePaddockScenario>;
}
