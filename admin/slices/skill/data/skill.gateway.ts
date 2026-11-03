import { SkillsService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ISkillGateway } from '../domain/skill.gateway';
import type {
  IImportFromGithubInput,
  IImportFromUrlInput,
  INameAvailability,
  ISkillData,
  ISkillDependentAgent,
  ISkillInput,
  ISkillOrder,
  ISkillOrderConflict,
  ISkillSearchHit,
} from '../domain/skill.types';
import { SkillMapper } from './skill.mapper';

/** The body of a 4xx the API sent, whatever axios wrapped it in. */
function errorBody(err: unknown): Record<string, unknown> | null {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

export class SkillGateway extends BaseGateway implements ISkillGateway {
  private mapper = new SkillMapper();

  /**
   * The generated client does not throw on a 4xx / 5xx: it hands back the
   * axios error with an `error` field, so a failed call would otherwise read
   * as an empty response. Throw it, so `execute` and the callers' catch
   * blocks (`response.data.code`) see the failure the way they expect.
   */
  private unwrap<T>(res: { data?: unknown; error?: unknown }): T | null {
    if (res.error !== undefined) throw res;
    return unwrapEnvelope<T>(res.data);
  }

  fetchOrder(): Promise<ISkillOrder> {
    return this.execute(async () => {
      const res = await SkillsService.getSkillOrder();
      return this.mapper.toOrder(this.unwrap(res));
    });
  }

  saveOrder(order: ISkillOrder): Promise<ISkillOrder> {
    return this.execute(async () => {
      try {
        const res = await SkillsService.saveSkillOrder({ body: order });
        return this.mapper.toOrder(this.unwrap(res));
      } catch (err) {
        // 409 ORDER_CHANGED is a state the store handles (reload), so it
        // travels as a typed value; everything else stays the raw error.
        const body = errorBody(err);
        if (body?.code === 'ORDER_CHANGED') {
          const conflict: ISkillOrderConflict = {
            code: 'ORDER_CHANGED',
            message: typeof body.message === 'string' ? body.message : 'The library order changed.',
          };
          throw conflict;
        }
        throw err;
      }
    });
  }

  isNameAvailable(name: string, excludeId?: string): Promise<INameAvailability> {
    return this.execute(async () => {
      const res = await SkillsService.skillNameAvailable({
        query: excludeId ? { name, excludeId } : { name },
      });
      return this.mapper.toNameAvailability(this.unwrap(res), name);
    });
  }

  findAll(): Promise<ISkillData[]> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerFindAll();
      return this.mapper.toList(this.unwrap(res));
    });
  }

  findById(id: string): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerFindById({ path: { id } });
      return this.mapper.toEntity(this.unwrap(res));
    });
  }

  create(input: ISkillInput): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.mapper.toEntity(this.unwrap(res));
    });
  }

  update(id: string, input: Partial<ISkillInput>): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.mapper.toEntity(this.unwrap(res));
    });
  }

  remove(id: string): Promise<void> {
    return this.execute(async () => {
      await SkillsService.skillControllerRemove({ path: { id } });
    });
  }

  search(q: string): Promise<ISkillSearchHit[]> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerSearch({ query: { q } });
      return this.mapper.toSearchHits(this.unwrap(res));
    });
  }

  importFromGithub(input: IImportFromGithubInput): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerImportFromGithub({
        body: input,
      });
      return this.mapper.toEntity(this.unwrap(res));
    });
  }

  importFromUrl(input: IImportFromUrlInput): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerImportFromUrl({
        body: input,
      });
      return this.mapper.toEntity(this.unwrap(res));
    });
  }

  findDependentAgents(id: string): Promise<ISkillDependentAgent[]> {
    return this.execute(async () => {
      const res = await SkillsService.findDependentAgents({ path: { id } });
      return this.mapper.toDependentAgents(this.unwrap(res));
    });
  }
}
