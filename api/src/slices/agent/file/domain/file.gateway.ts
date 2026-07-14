import {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISkillBundle,
} from './file.types';

export abstract class IFileGateway {
  abstract list(agentId: string): Promise<IFileNode[]>;
  abstract read(agentId: string, path: string): Promise<IFileContent>;
  // Range read for files that exceed the editor's MAX_BYTES cap. Used by
  // the chunked viewer (admin Files tab) and the transcript pagination
  // (bridle replay reads the JSONL from the tail backward).
  abstract readRange(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk>;
  abstract save(agentId: string, path: string, content: string): Promise<void>;
  /**
   * Like save(), but without the editable-extension guard. For internal
   * callers that legitimately need to write non-.md/.json files — e.g.
   * the bridle controller archiving a .jsonl transcript. Do NOT wire
   * this to user-facing endpoints; the guard on save() exists to keep
   * the file-editor UI from being used to overwrite binary blobs.
   */
  abstract saveRaw(agentId: string, path: string, content: string): Promise<void>;
  abstract delete(agentId: string, path: string): Promise<void>;
  // Delete every object under `agents/{agentId}/{path}/`. Used by the admin
  // Files tab to remove whole folders (e.g. an agent-owned skill dir that
  // syncSkills won't touch). Returns the number of keys deleted.
  abstract deletePrefix(agentId: string, path: string): Promise<number>;
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
