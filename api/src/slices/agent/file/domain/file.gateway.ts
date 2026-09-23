import {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISaveOptions,
  ISkillBundle,
} from './file.types';
import { IImportStageMeta } from './import.types';

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
  /**
   * Save a text file of any recognised text kind (CLEAN-112). `.json` must
   * parse. `options.createOnly` → 409 if present; `options.ifUnmodifiedSince`
   * → 412 if the object changed after that instant.
   */
  abstract save(
    agentId: string,
    path: string,
    content: string,
    options?: ISaveOptions,
  ): Promise<void>;
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
  // `paths` (CLEAN-112): only these files, or folders by prefix.
  abstract exportZip(
    agentId: string,
    paths?: string[],
  ): Promise<{ filename: string; buffer: Buffer }>;
  // ── Change proposals (CLEAN-112) ──────────────────────────────
  /** ETag of the stored object (quotes stripped), or null when absent. */
  abstract headEtag(agentId: string, path: string): Promise<string | null>;
  /** Proposed content lives outside every agent prefix until applied. */
  abstract putProposalContent(proposalId: string, content: string): Promise<void>;
  abstract getProposalContent(proposalId: string): Promise<string | null>;
  abstract deleteProposalContent(proposalId: string): Promise<void>;

  /**
   * The raw object as a stream, for the "Open full" link (CLEAN-112). No
   * size cap: the browser renders or downloads whatever is stored.
   */
  abstract streamRaw(
    agentId: string,
    path: string,
  ): Promise<{
    body: NodeJS.ReadableStream;
    size: number;
    contentType: string;
    kind: 'text' | 'binary';
  }>;

  // ── Workspace import (CLEAN-112) ─────────────────────────────

  /** Every key with its S3 ETag (quotes stripped) — the import plan's basis. */
  abstract listWithEtags(
    agentId: string,
  ): Promise<Array<{ path: string; size: number; etag: string }>>;
  /** Write any bytes (text or binary) at `path`; content type from the path unless given. */
  abstract putObjectRaw(
    agentId: string,
    path: string,
    bytes: Buffer,
    contentType?: string,
  ): Promise<void>;
  /** Staged archives live at bucket-root `imports/<agentId>/<importId>.zip`. */
  abstract putStage(
    agentId: string,
    importId: string,
    zip: Buffer,
    meta: IImportStageMeta,
  ): Promise<void>;
  abstract getStage(
    agentId: string,
    importId: string,
  ): Promise<{ zip: Buffer; meta: IImportStageMeta } | null>;
  abstract deleteStage(agentId: string, importId: string): Promise<void>;
  /** Remove stages older than `olderThanMin`; returns how many went. */
  abstract sweepStages(olderThanMin: number): Promise<number>;
}
