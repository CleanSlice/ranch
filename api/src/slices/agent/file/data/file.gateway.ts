import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import * as archiver from 'archiver';
import { ISettingGateway } from '#/setting/domain';
import { IFileGateway } from '../domain/file.gateway';
import {
  IFileChunk,
  IFileContent,
  IFileNode,
  ISaveOptions,
  ISkillBundle,
} from '../domain/file.types';
import {
  MAX_EDIT_BYTES,
  MAX_RANGE_BYTES,
  RANGE_BYTES,
} from '../domain/file.limits';
import { IImportStageMeta } from '../domain/import.types';
import {
  FileKind,
  SNIFF_BYTES,
  extensionOf,
  isEditable,
  kindFromPath,
  sniffKind,
  trailingPartialUtf8,
} from '../domain/fileKind';

// Staged import archives (CLEAN-112) live outside every agent prefix.
const STAGE_PREFIX = 'imports/';

// Every cap lives in domain/file.limits.ts (CLEAN-112). `MAX_EDIT_BYTES`
// (1 MiB since CLEAN-56: 256KB was too small for large SOUL.md instructions)
// is what main.ts's express json body limit must stay above.
const MAX_BYTES = MAX_EDIT_BYTES;
const DEFAULT_RANGE_BYTES = RANGE_BYTES;

/**
 * Turn the raw bytes of a range read into a chunk that never ends in the
 * middle of a UTF-8 character (CLEAN-112, FR-009). When the slice does not
 * reach the end of the object, a trailing partial sequence is handed back to
 * the next request by shortening `size`/`nextOffset`. At the end of the
 * object nothing is trimmed — a truncated final byte is the file's own.
 */
const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8',
  '.sh': 'text/x-shellscript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

export function contentTypeFor(path: string): string {
  const ext = extensionOf(path);
  if (ext in CONTENT_TYPES) return CONTENT_TYPES[ext];
  return kindFromPath(path) === 'binary'
    ? 'application/octet-stream'
    : 'text/plain; charset=utf-8';
}

/** `JSON.parse` with a "line L col C" message the editor can show. */
export function assertJson(content: string): void {
  try {
    JSON.parse(content);
  } catch (err) {
    const msg = (err as Error).message;
    const at = jsonErrorPosition(content, msg);
    if (at) {
      throw new BadRequestException(
        `invalid JSON at line ${at.line} col ${at.col}: ${msg}`,
      );
    }
    throw new BadRequestException(`invalid JSON: ${msg}`);
  }
}

/**
 * V8 has had three message shapes: `… at position N`, `… (line L column C)`
 * and `Unexpected token 'x', "…<context>" is not valid JSON` where the
 * context ends at the offending token. All three are turned into line/col.
 */
export function jsonErrorPosition(
  content: string,
  message: string,
): { line: number; col: number } | null {
  const lineCol = /line (\d+) column (\d+)/.exec(message);
  if (lineCol) return { line: Number(lineCol[1]), col: Number(lineCol[2]) };

  let pos: number | null = null;
  const position = /position (\d+)/.exec(message);
  if (position) {
    pos = Number(position[1]);
  } else {
    const ctx = /, (?:\.\.\.)?"([\s\S]*?)"(?:\.\.\.)? is not valid JSON$/.exec(
      message,
    );
    if (ctx) {
      const snippet = ctx[1];
      const idx = snippet ? content.indexOf(snippet) : -1;
      if (idx >= 0) pos = idx + Math.max(0, snippet.length - 1);
    }
  }
  if (pos === null) return null;
  const before = content.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  return { line, col };
}

export function sliceChunk(
  raw: Buffer,
  offset: number,
  totalSize: number,
): Pick<IFileChunk, 'content' | 'size' | 'offset' | 'nextOffset' | 'hasMore'> {
  const reachesEnd = offset + raw.length >= totalSize;
  const trim = reachesEnd ? 0 : trailingPartialUtf8(raw);
  const kept = trim > 0 ? raw.subarray(0, raw.length - trim) : raw;
  const size = kept.length;
  const nextOffset = offset + size;
  const hasMore = nextOffset < totalSize;
  return {
    content: kept.toString('utf-8'),
    size,
    offset,
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
  };
}

// Prefixes the runtime writes to at runtime (state that must survive restarts).
// resyncFromTemplate refuses to overwrite anything under these — only template-
// owned files (skills, instructions, etc.) get pushed on every restart.
const AGENT_OWNED_PREFIXES = ['data/', 'memory/', 'sessions/', 'workspace/'];

// Root-level identity files operators customize per agent (CLEAN-56: a
// template resync on restart used to clobber an edited SOUL.md — the exact
// "save + restart and my edit is gone" report). The template only PROVIDES
// these to agents that don't have them yet; once present, the agent copy is
// authoritative. Other root files (e.g. agent.config.json) keep template-wins
// semantics so template updates still propagate on restart.
const AGENT_OWNED_ROOT_FILES = new Set([
  'SOUL.md',
  'USER.md',
  'HEARTBEAT.md',
  'MEMORY.md',
]);

@Injectable()
export class S3FileGateway extends IFileGateway {
  // Sentinel file written into every template-managed skill dir. syncSkills
  // wipes only dirs carrying it — agent-created skills (skill_write) never
  // get one and survive restarts.
  static readonly MANAGED_MARKER = '.ranch-managed';

  constructor(private settings: ISettingGateway) {
    super();
  }

  async list(agentId: string): Promise<IFileNode[]> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(agentId);

    const out: IFileNode[] = [];
    let continuationToken: string | undefined;

    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        const path = obj.Key.slice(prefix.length);
        if (!path) continue;
        const size = obj.Size ?? 0;
        const kind = await this.classify(client, bucket, obj.Key, path, size);
        out.push({
          path,
          size,
          updatedAt: obj.LastModified ?? new Date(0),
          kind,
          editable: isEditable(kind, size),
        });
      }
      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Text or binary (CLEAN-112). Extension first; unknown extensions get
   * their first few KB sniffed. Empty objects are text (nothing to sniff).
   */
  private async classify(
    client: S3Client,
    bucket: string,
    key: string,
    path: string,
    size: number,
  ): Promise<FileKind> {
    const guess = kindFromPath(path);
    if (guess !== 'unknown') return guess;
    if (size === 0) return 'text';
    try {
      const res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=0-${Math.min(size, SNIFF_BYTES) - 1}`,
        }),
      );
      const head = Buffer.from(
        (await res.Body?.transformToByteArray()) ?? new Uint8Array(),
      );
      return sniffKind(head);
    } catch {
      // A sniff that fails (object vanished between list and get, throttling)
      // must not break the listing — call it binary, the safe side.
      return 'binary';
    }
  }


  async streamRaw(
    agentId: string,
    path: string,
  ): Promise<{
    body: NodeJS.ReadableStream;
    size: number;
    contentType: string;
    kind: FileKind;
  }> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      if (this.isNotFound(err)) throw new NotFoundException('File not found');
      throw err;
    }
    const size = head.ContentLength ?? 0;
    const kind = await this.classify(client, bucket, key, path, size);

    let res;
    try {
      res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      if (this.isNotFound(err)) throw new NotFoundException('File not found');
      throw err;
    }
    if (!res.Body) throw new NotFoundException('File not found');

    return {
      body: res.Body as unknown as NodeJS.ReadableStream,
      size,
      contentType: contentTypeFor(path),
      kind,
    };
  }

  async read(agentId: string, path: string): Promise<IFileContent> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      if (this.isNotFound(err)) throw new NotFoundException('File not found');
      throw err;
    }

    const size = head.ContentLength ?? 0;
    if (size > MAX_BYTES) {
      throw new BadRequestException(
        `File too large to view (${size} > ${MAX_BYTES} bytes)`,
      );
    }

    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = Buffer.from(
      (await res.Body?.transformToByteArray()) ?? new Uint8Array(),
    );
    const guess = kindFromPath(path);
    const kind: FileKind = guess === 'unknown' ? sniffKind(bytes) : guess;

    return {
      path,
      content: bytes.toString('utf-8'),
      size,
      updatedAt: head.LastModified ?? new Date(0),
      kind,
      editable: isEditable(kind, size),
    };
  }

  async readRange(
    agentId: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<IFileChunk> {
    this.assertSafePath(path);

    const safeOffset = Math.max(0, Math.floor(offset || 0));
    const requested = Math.floor(limit || DEFAULT_RANGE_BYTES);
    const safeLimit = Math.min(
      MAX_RANGE_BYTES,
      Math.max(1, requested || DEFAULT_RANGE_BYTES),
    );

    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

    let head;
    try {
      head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      if (this.isNotFound(err)) throw new NotFoundException('File not found');
      throw err;
    }

    const totalSize = head.ContentLength ?? 0;
    const updatedAt = head.LastModified ?? new Date(0);
    const kind = await this.classify(client, bucket, key, path, totalSize);
    if (kind === 'binary') {
      throw new BadRequestException(`${path} is not a text file`);
    }
    const editable = isEditable(kind, totalSize);

    if (totalSize === 0 || safeOffset >= totalSize) {
      return {
        path,
        content: '',
        size: 0,
        totalSize,
        offset: safeOffset,
        nextOffset: null,
        hasMore: false,
        updatedAt,
        kind,
        editable,
      };
    }

    const end = Math.min(totalSize - 1, safeOffset + safeLimit - 1);
    const res = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        Range: `bytes=${safeOffset}-${end}`,
      }),
    );
    const raw = Buffer.from(
      (await res.Body?.transformToByteArray()) ?? new Uint8Array(),
    );
    return {
      ...sliceChunk(raw, safeOffset, totalSize),
      path,
      totalSize,
      updatedAt,
      kind,
      editable,
    };
  }

  async save(
    agentId: string,
    path: string,
    content: string,
    options: ISaveOptions = {},
  ): Promise<void> {
    this.assertSafePath(path);

    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_BYTES) {
      throw new BadRequestException(
        `File too large to save (${bytes} > ${MAX_BYTES} bytes)`,
      );
    }

    // Any text kind may be written (CLEAN-112). A path whose extension says
    // nothing is judged by the bytes being saved; a known-binary extension
    // is refused outright.
    const guess = kindFromPath(path);
    const kind: FileKind =
      guess === 'unknown' ? sniffKind(Buffer.from(content, 'utf-8')) : guess;
    if (kind !== 'text') {
      throw new BadRequestException(
        `${path} is not a text file — only text files can be edited`,
      );
    }

    if (extensionOf(path) === '.json') {
      assertJson(content);
    }

    if (options.createOnly || options.ifUnmodifiedSince) {
      const { client, bucket } = await this.connect();
      const key = this.prefix(agentId) + path;
      let head: { LastModified?: Date } | null = null;
      try {
        head = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        );
      } catch (err) {
        if (!this.isNotFound(err)) throw err;
      }
      if (options.createOnly && head) {
        throw new ConflictException(`${path} already exists`);
      }
      if (
        options.ifUnmodifiedSince &&
        head?.LastModified &&
        head.LastModified.getTime() > options.ifUnmodifiedSince.getTime() + 999
      ) {
        throw new PreconditionFailedException(
          `${path} changed since you opened it`,
        );
      }
    }

    await this.putObject(agentId, path, content);
  }

  async saveRaw(agentId: string, path: string, content: string): Promise<void> {
    this.assertSafePath(path);
    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_BYTES) {
      throw new BadRequestException(
        `File too large to save (${bytes} > ${MAX_BYTES} bytes)`,
      );
    }
    await this.putObject(agentId, path, content);
  }

  private async putObject(
    agentId: string,
    path: string,
    content: string,
  ): Promise<void> {
    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: content,
        ContentType: this.contentType(path),
      }),
    );
  }

  async delete(agentId: string, path: string): Promise<void> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const key = this.prefix(agentId) + path;

    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      // S3 DELETE is idempotent — 404 isn't typically returned, but treat
      // any not-found as success so callers (e.g. "reset chat") don't fail
      // when the file already doesn't exist.
      if (this.isNotFound(err)) return;
      throw err;
    }
  }

  async deletePrefix(agentId: string, path: string): Promise<number> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    const folderPrefix =
      this.prefix(agentId) + (path.endsWith('/') ? path : path + '/');

    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: folderPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (list.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return deleted;
  }

  // Server-side copy of every file under templates/{templateId}/ into
  // agents/{agentId}/. Skips agents that already have files (re-deploys
  // must not overwrite evolved state). Returns the number of files copied.
  async seedFromTemplate(agentId: string, templateId: string): Promise<number> {
    const { client, bucket } = await this.connect();
    const destPrefix = this.prefix(agentId);
    const srcPrefix = `templates/${templateId}/`;

    const existing = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: destPrefix,
        MaxKeys: 1,
      }),
    );
    if ((existing.Contents ?? []).length > 0) return 0;

    let copied = 0;
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: srcPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of list.Contents ?? []) {
        if (!obj.Key) continue;
        const rel = obj.Key.slice(srcPrefix.length);
        if (!rel) continue;
        // Skip legacy `.agent/*` keys from old template installs — they
        // map to `.agent/.agent/*` on the pod and runtime ignores them.
        if (rel.startsWith('.agent/')) continue;
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: destPrefix + rel,
            CopySource: encodeURI(`${bucket}/${obj.Key}`),
          }),
        );
        copied++;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return copied;
  }

  // Force-copies template-owned files into the agent's prefix, preserving
  // anything under AGENT_OWNED_PREFIXES (runtime state). Called from restart
  // so template edits (new skills, updated instructions) propagate without
  // wiping out the agent's memory / sessions / workspace.
  async resyncFromTemplate(
    agentId: string,
    templateId: string,
  ): Promise<number> {
    const { client, bucket } = await this.connect();
    const destPrefix = this.prefix(agentId);
    const srcPrefix = `templates/${templateId}/`;

    // One-time heal: drop any stray `agents/{id}/.agent/*` keys left over
    // from the legacy templateInstall layout. The runtime never reads them
    // (S3 path == runtime path == agent prefix root) so they were just
    // storage clutter pulled in as `.agent/.agent/*` on the pod.
    await this.wipeLegacyAgentPrefix(client, bucket, destPrefix);

    // Root-level objects the agent already has — the guard set for
    // AGENT_OWNED_ROOT_FILES. Delimiter='/' keeps the listing to the prefix
    // root, so a large sessions/ tree doesn't inflate the call.
    const existingRoot = new Set<string>();
    const rootList = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: destPrefix,
        Delimiter: '/',
      }),
    );
    for (const obj of rootList.Contents ?? []) {
      if (obj.Key) existingRoot.add(obj.Key.slice(destPrefix.length));
    }

    let copied = 0;
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: srcPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of list.Contents ?? []) {
        if (!obj.Key) continue;
        const rel = obj.Key.slice(srcPrefix.length);
        if (!rel) continue;
        if (AGENT_OWNED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        // Identity files are copy-if-missing: never clobber a customized one.
        if (AGENT_OWNED_ROOT_FILES.has(rel) && existingRoot.has(rel)) continue;
        // Skip legacy `.agent/*` keys from old template installs — they
        // map to `.agent/.agent/*` on the pod and runtime ignores them.
        if (rel.startsWith('.agent/')) continue;
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: destPrefix + rel,
            CopySource: encodeURI(`${bucket}/${obj.Key}`),
          }),
        );
        copied++;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return copied;
  }

  private async wipeLegacyAgentPrefix(
    client: S3Client,
    bucket: string,
    agentPrefix: string,
  ): Promise<void> {
    const legacyPrefix = agentPrefix + '.agent/';
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: legacyPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (list.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  // Resync `skills/` for this agent from the supplied bundle. Called from
  // deploy / restart so the runtime sees the set currently attached to the
  // template (skill.body + sibling files). Skill paths live at the agent
  // prefix root (no `.agent/` segment) — that path is the runtime's local
  // convention, not the S3 storage layout.
  //
  // Only TEMPLATE-MANAGED skill dirs are wiped before the rewrite — the ones
  // carrying the MANAGED_MARKER sentinel this method writes. Dirs without it
  // (created by the agent itself via skill_write, or uploaded by hand) are
  // left untouched: the previous wipe-the-whole-prefix behavior deleted the
  // agent's own skills from S3 on every restart, and the dying pod's final
  // diff push couldn't restore them (its manifest saw them as unchanged).
  // Detached template skills still disappear — they carry the marker.
  // Trade-off: skills written by pre-marker ranch versions are treated as
  // agent-owned and linger until removed by hand.
  async syncSkills(agentId: string, skills: ISkillBundle[]): Promise<number> {
    const { client, bucket } = await this.connect();
    const skillsPrefix = this.prefix(agentId) + 'skills/';

    // One listing pass: collect every key under skills/ and note which
    // top-level skill dirs carry the managed marker.
    const allKeys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: skillsPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of list.Contents ?? []) {
        if (obj.Key) allKeys.push(obj.Key);
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);

    const skillDirOf = (key: string): string =>
      key.slice(skillsPrefix.length).split('/')[0];
    const managedDirs = new Set<string>(
      allKeys
        .filter((k) => k.endsWith('/' + S3FileGateway.MANAGED_MARKER))
        .map(skillDirOf),
    );

    const doomed = allKeys.filter((k) => managedDirs.has(skillDirOf(k)));
    // DeleteObjects caps at 1000 keys per request.
    for (let i = 0; i < doomed.length; i += 1000) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: doomed.slice(i, i + 1000).map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    }

    let written = 0;
    for (const skill of skills) {
      const base = `${skillsPrefix}${skill.name}/`;
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: base + 'SKILL.md',
          Body: skill.body,
          ContentType: this.contentType('SKILL.md'),
        }),
      );
      written++;
      for (const file of skill.files ?? []) {
        if (!file.path) continue;
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: base + file.path,
            Body: file.content,
            ContentType: this.contentType(file.path),
          }),
        );
        written++;
      }
      // Sentinel marking this dir as template-managed → wipeable on the
      // next resync. Not counted in `written` (it's bookkeeping, not content).
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: base + S3FileGateway.MANAGED_MARKER,
          Body: '',
        }),
      );
    }
    return written;
  }

  // Wipe everything under `agents/{agentId}/`. S3 DELETE is idempotent —
  // no error if the prefix is already empty. Returns the number of keys
  // deleted so the controller can log.
  async wipe(agentId: string): Promise<number> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(agentId);
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (list.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => Boolean(k));
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return deleted;
  }

  // Pack every object under `agents/{agentId}/` into a ZIP. Skips
  // pathological keys (empty rel, traversal segments) defensively.
  async exportZip(
    agentId: string,
    paths?: string[],
  ): Promise<{ filename: string; buffer: Buffer }> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(agentId);
    // A selection (CLEAN-112): exact files, or folders by prefix.
    const wanted = (paths ?? []).map((p) => {
      this.assertSafePath(p);
      return p;
    });
    const selected = (rel: string): boolean =>
      wanted.length === 0 ||
      wanted.some((w) => rel === w || rel.startsWith(w.endsWith('/') ? w : w + '/'));

    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of list.Contents ?? []) {
        if (!obj.Key) continue;
        const rel = obj.Key.slice(prefix.length);
        if (!rel) continue;
        if (rel.split('/').some((s) => s === '..' || s === '.')) continue;
        if (!selected(rel)) continue;
        const res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: obj.Key }),
        );
        const body =
          (await res.Body?.transformToByteArray()) ?? new Uint8Array();
        archive.append(Buffer.from(body), { name: rel });
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);

    await archive.finalize();
    await done;

    return {
      filename:
        wanted.length > 0
          ? `agent-${agentId}-selection.zip`
          : `agent-${agentId}.zip`,
      buffer: Buffer.concat(chunks),
    };
  }

  // ── Workspace import (CLEAN-112) ─────────────────────────────

  async listWithEtags(
    agentId: string,
  ): Promise<Array<{ path: string; size: number; etag: string }>> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(agentId);
    const out: Array<{ path: string; size: number; etag: string }> = [];
    let continuationToken: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of res.Contents ?? []) {
        if (!obj.Key) continue;
        const path = obj.Key.slice(prefix.length);
        if (!path) continue;
        out.push({
          path,
          size: obj.Size ?? 0,
          etag: (obj.ETag ?? '').replace(/^"|"$/g, ''),
        });
      }
      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return out;
  }

  async putObjectRaw(
    agentId: string,
    path: string,
    bytes: Buffer,
    contentType?: string,
  ): Promise<void> {
    this.assertSafePath(path);
    const { client, bucket } = await this.connect();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.prefix(agentId) + path,
        Body: bytes,
        ContentType: contentType ?? this.contentType(path),
      }),
    );
  }

  private stageKey(agentId: string, importId: string): string {
    return `${STAGE_PREFIX}${agentId}/${importId}.zip`;
  }

  async putStage(
    agentId: string,
    importId: string,
    zip: Buffer,
    meta: IImportStageMeta,
  ): Promise<void> {
    const { client, bucket } = await this.connect();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: this.stageKey(agentId, importId),
        Body: zip,
        ContentType: 'application/zip',
        Metadata: {
          agentid: meta.agentId,
          source: meta.source,
          size: String(meta.size),
          entries: String(meta.entries),
          createdat: meta.createdAt.toISOString(),
        },
      }),
    );
  }

  async getStage(
    agentId: string,
    importId: string,
  ): Promise<{ zip: Buffer; meta: IImportStageMeta } | null> {
    const { client, bucket } = await this.connect();
    let res;
    try {
      res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: this.stageKey(agentId, importId),
        }),
      );
    } catch (err) {
      if (this.isNotFound(err)) return null;
      throw err;
    }
    const zip = Buffer.from(
      (await res.Body?.transformToByteArray()) ?? new Uint8Array(),
    );
    const m = res.Metadata ?? {};
    const source = m.source;
    return {
      zip,
      meta: {
        agentId: m.agentid ?? agentId,
        source:
          source === 'attachment' || source === 'url' ? source : 'upload',
        size: Number(m.size ?? zip.length) || zip.length,
        entries: Number(m.entries ?? 0) || 0,
        createdAt: m.createdat
          ? new Date(m.createdat)
          : (res.LastModified ?? new Date(0)),
      },
    };
  }

  async deleteStage(agentId: string, importId: string): Promise<void> {
    const { client, bucket } = await this.connect();
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: this.stageKey(agentId, importId),
        }),
      );
    } catch (err) {
      if (this.isNotFound(err)) return;
      throw err;
    }
  }

  async sweepStages(olderThanMin: number): Promise<number> {
    const { client, bucket } = await this.connect();
    const cutoff = Date.now() - olderThanMin * 60 * 1000;
    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const list = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: STAGE_PREFIX,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (list.Contents ?? [])
        .filter(
          (o) => o.Key && o.LastModified && o.LastModified.getTime() < cutoff,
        )
        .map((o) => o.Key as string);
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        deleted += keys.length;
      }
      continuationToken = list.IsTruncated
        ? list.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return deleted;
  }

  private prefix(agentId: string): string {
    return `agents/${agentId}/`;
  }

  private assertSafePath(path: string): void {
    if (!path) throw new BadRequestException('Path is required');
    if (path.startsWith('/'))
      throw new BadRequestException('Path must be relative');
    if (path.includes('\0')) throw new BadRequestException('Invalid path');
    const segments = path.split('/');
    if (segments.some((s) => s === '..' || s === '.')) {
      throw new BadRequestException('Path traversal not allowed');
    }
  }

  private contentType(path: string): string {
    return contentTypeFor(path);
  }

  private isNotFound(err: unknown): boolean {
    if (err instanceof S3ServiceException) {
      return err.name === 'NotFound' || err.name === 'NoSuchKey';
    }
    return false;
  }

  private async connect(): Promise<{ client: S3Client; bucket: string }> {
    const get = async (name: string): Promise<string> => {
      const setting = await this.settings.findByKey('integrations', name);
      const value = setting?.value;
      return typeof value === 'string' ? value : '';
    };

    const [bucket, region, accessKeyId, secretAccessKey, endpoint] =
      await Promise.all([
        get('s3_bucket'),
        get('aws_region'),
        get('aws_access_key_id'),
        get('aws_secret_access_key'),
        get('s3_endpoint'),
      ]);

    if (!bucket) {
      throw new BadRequestException(
        'S3 bucket is not configured (settings → integrations → s3_bucket)',
      );
    }
    // Credentials are optional: when both are present we pass them explicitly
    // (static keys / local MinIO). When blank we OMIT `credentials` so the AWS
    // SDK default provider chain resolves them — this is what lets an EKS pod
    // authenticate through its IRSA / Pod Identity role with no static keys.
    const client = new S3Client({
      region: region || 'us-east-1',
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });

    return { client, bucket };
  }
}
