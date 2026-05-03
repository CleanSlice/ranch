import {
  IPaddockScenarioData,
  ICreatePaddockScenarioData,
  IUpdatePaddockScenarioData,
} from './scenario.types';

export interface IFindPaddockScenariosFilter {
  templateId?: string;
  agentId?: string;
}

export abstract class IPaddockScenarioGateway {
  abstract findAll(
    filter?: IFindPaddockScenariosFilter,
  ): Promise<IPaddockScenarioData[]>;
  abstract findById(id: string): Promise<IPaddockScenarioData | null>;
  abstract findForAgent(agentId: string): Promise<IPaddockScenarioData[]>;
  abstract create(
    data: ICreatePaddockScenarioData,
  ): Promise<IPaddockScenarioData>;
  abstract update(
    id: string,
    data: IUpdatePaddockScenarioData,
  ): Promise<IPaddockScenarioData>;
  abstract delete(id: string): Promise<void>;
}
