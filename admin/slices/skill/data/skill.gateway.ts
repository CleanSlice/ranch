import { SkillsService } from '#api/data';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { ISkillGateway } from '../domain/skill.gateway';
import type {
  IImportFromGithubInput,
  IImportFromUrlInput,
  ISkillData,
  ISkillDependentAgent,
  ISkillInput,
  ISkillSearchHit,
} from '../domain/skill.types';
import { SkillMapper } from './skill.mapper';

export class SkillGateway extends BaseGateway implements ISkillGateway {
  private mapper = new SkillMapper();

  findAll(): Promise<ISkillData[]> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerFindAll();
      return this.mapper.toList(unwrapEnvelope(res.data));
    });
  }

  findById(id: string): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerFindById({ path: { id } });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  create(input: ISkillInput): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerCreate({
        body: this.mapper.toCreateDto(input),
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  update(id: string, input: Partial<ISkillInput>): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerUpdate({
        path: { id },
        body: this.mapper.toUpdateDto(input),
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
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
      return this.mapper.toSearchHits(unwrapEnvelope(res.data));
    });
  }

  importFromGithub(input: IImportFromGithubInput): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerImportFromGithub({
        body: input,
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  importFromUrl(input: IImportFromUrlInput): Promise<ISkillData | null> {
    return this.execute(async () => {
      const res = await SkillsService.skillControllerImportFromUrl({
        body: input,
      });
      return this.mapper.toEntity(unwrapEnvelope(res.data));
    });
  }

  findDependentAgents(id: string): Promise<ISkillDependentAgent[]> {
    return this.execute(async () => {
      const res = await SkillsService.findDependentAgents({ path: { id } });
      return this.mapper.toDependentAgents(unwrapEnvelope(res.data));
    });
  }
}
