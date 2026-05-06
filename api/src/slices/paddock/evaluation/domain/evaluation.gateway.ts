import {
  IPaddockEvaluationData,
  IPaddockEvaluationResultData,
  IPaddockJudgeConfig,
  IUpdatePaddockEvaluationData,
} from './evaluation.types';
import { IPaddockScenarioData } from '../../scenario/domain';

export interface IFindPaddockEvaluationsFilter {
  agentId?: string;
  templateId?: string;
  limit?: number;
}

export interface ICreatePaddockEvaluationRecord {
  agentId: string;
  templateId: string | null;
  judgeConfig: IPaddockJudgeConfig;
  scenariosSnapshot: IPaddockScenarioData[];
}

export abstract class IPaddockEvaluationGateway {
  abstract findAll(
    filter?: IFindPaddockEvaluationsFilter,
  ): Promise<IPaddockEvaluationData[]>;
  abstract findById(id: string): Promise<IPaddockEvaluationData | null>;
  abstract create(
    data: ICreatePaddockEvaluationRecord,
  ): Promise<IPaddockEvaluationData>;
  abstract update(
    id: string,
    data: IUpdatePaddockEvaluationData,
  ): Promise<IPaddockEvaluationData>;
  abstract addResults(
    id: string,
    results: Omit<IPaddockEvaluationResultData, 'id' | 'evaluationId'>[],
  ): Promise<void>;
  abstract findRunning(agentId: string): Promise<IPaddockEvaluationData | null>;
}
