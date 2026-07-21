import { PaddockScenariosService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IPaddockScenarioGateway } from '../domain/paddockScenario.gateway';
import type {
  ICreatePaddockScenario,
  IGeneratePaddockScenario,
  IPaddockScenario,
  IUpdatePaddockScenario,
} from '../domain/paddockScenario.types';
import { PaddockScenarioMapper } from './paddockScenario.mapper';

export class PaddockScenarioGateway
  extends BaseGateway
  implements IPaddockScenarioGateway
{
  private mapper = new PaddockScenarioMapper();

  findAll(filter: {
    templateId?: string;
    agentId?: string;
  }): Promise<IPaddockScenario[]> {
    return this.execute(async () => {
      const res = await PaddockScenariosService.paddockScenarioControllerFindAll(
        { query: filter },
      );
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<IPaddockScenario | null> {
    return this.execute(async () => {
      const res =
        await PaddockScenariosService.paddockScenarioControllerFindById({
          path: { id },
        });
      return this.mapper.toScenario(unwrapEnvelope(res.data));
    });
  }

  create(input: ICreatePaddockScenario): Promise<IPaddockScenario> {
    return this.execute(async () => {
      const res = await PaddockScenariosService.paddockScenarioControllerCreate({
        body: input,
      });
      return this.scenarioOrThrow(res, 'Scenario create');
    });
  }

  update(
    id: string,
    input: IUpdatePaddockScenario,
  ): Promise<IPaddockScenario> {
    return this.execute(async () => {
      const res = await PaddockScenariosService.paddockScenarioControllerUpdate({
        path: { id },
        body: input,
      });
      return this.scenarioOrThrow(res, 'Scenario update');
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      const res = await PaddockScenariosService.paddockScenarioControllerRemove({
        path: { id },
      });
      const err = (res as { error?: { message?: string } }).error;
      if (err) throw new Error(err.message ?? 'Failed to delete scenario');
    });
  }

  generate(input: IGeneratePaddockScenario): Promise<ICreatePaddockScenario> {
    return this.execute(async () => {
      const res =
        await PaddockScenariosService.paddockScenarioControllerGenerate({
          body: input,
        });
      const draft = this.mapper.toCreateInput(unwrapEnvelope(res.data));
      if (draft) return draft;
      const err = (res as { error?: { message?: string } }).error;
      throw new Error(err?.message ?? 'Failed to generate scenario');
    });
  }

  private scenarioOrThrow(
    res: { data?: unknown },
    action: string,
  ): IPaddockScenario {
    const scenario = this.mapper.toScenario(unwrapEnvelope(res.data));
    if (!scenario) throw new Error(`${action} returned no data`);
    return scenario;
  }
}
