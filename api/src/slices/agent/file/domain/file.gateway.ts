import { IFileContent, IFileNode, ISkillBundle } from './file.types';

export abstract class IFileGateway {
  abstract list(agentId: string): Promise<IFileNode[]>;
  abstract read(agentId: string, path: string): Promise<IFileContent>;
  abstract save(agentId: string, path: string, content: string): Promise<void>;
  abstract delete(agentId: string, path: string): Promise<void>;
  abstract seedFromTemplate(
    agentId: string,
    templateId: string,
  ): Promise<number>;
  abstract resyncFromTemplate(
    agentId: string,
    templateId: string,
  ): Promise<number>;
  // Wipe + rewrite `.agent/skills/` from the supplied bundle. Source of
  // truth is the DB (Template.skills); detached skills disappear because
  // the prefix is wiped first.
  abstract syncSkills(agentId: string, skills: ISkillBundle[]): Promise<number>;
  // Delete every object under `agents/{agentId}/`. Called from the delete
  // flow when the operator opts in to S3 cleanup. Idempotent.
  abstract wipe(agentId: string): Promise<number>;
  // Stream every object under `agents/{agentId}/` into a ZIP buffer. Used
  // by the admin UI before a destructive operation so the operator can
  // pre-download the agent's state.
  abstract exportZip(
    agentId: string,
  ): Promise<{ filename: string; buffer: Buffer }>;
}
