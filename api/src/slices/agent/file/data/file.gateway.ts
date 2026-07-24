import {
  Injectable,
  BadRequestException,
  NotFoundException,
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
  ISkillBundle,
} from '../domain/file.types';

const MAX_BYTES = 256 * 1024;
// Range reads bypass the editor cap — used by the chunked viewer and the
// transcript replay. Per-request cap so a malicious / buggy caller can't
// ask for a 100 MB slice in one go.
const MAX_RANGE_BYTES = 512 * 1024;
const DEFAULT_RANGE_BYTES = 256 * 1024;
const ALLOWED_WRITE_EXT = new Set(['.md', '.json']);

// Prefixes the runtime writes to at runtime (state that must survive restarts).
// resyncFromTemplate refuses to overwrite anything under these — only template-
// owned files (skills, instructions, etc.) get pushed on every restart.
const AGENT_OWNED_PREFIXES = ['data/', 'memory/', 'sessions/', 'workspace/'];

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
        out.push({
          path: obj.Key.slice(prefix.length),
          size: obj.Size ?? 0,
          updatedAt: obj.LastModified ?? new Date(0),
        });
      }
      continuationToken = res.IsTruncated
        ? res.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return out.sort((a, b) => a.path.localeCompare(b.path));
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
    const content = (await res.Body?.transformToString('utf-8')) ?? '';

    return {
      path,
      content,
      size,
      updatedAt: head.LastModified ?? new Date(0),
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
    const content = (await res.Body?.transformToString('utf-8')) ?? '';
    const bytesRead = Buffer.byteLength(content, 'utf-8');
    const nextOffset = safeOffset + bytesRead;
    const hasMore = nextOffset < totalSize;

    return {
      path,
      content,
      size: bytesRead,
      totalSize,
      offset: safeOffset,
      nextOffset: hasMore ? nextOffset : null,
      hasMore,
      updatedAt,
    };
  }

  async save(agentId: string, path: string, content: string): Promise<void> {
    this.assertSafePath(path);
    this.assertWritableExt(path);

    const bytes = Buffer.byteLength(content, 'utf-8');
    if (bytes > MAX_BYTES) {
      throw new BadRequestException(
        `File too large to save (${bytes} > ${MAX_BYTES} bytes)`,
      );
    }

    if (path.endsWith('.json')) {
      try {
        JSON.parse(content);
      } catch (err) {
        throw new BadRequestException(
          `Invalid JSON: ${(err as Error).message}`,
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
  ): Promise<{ filename: string; buffer: Buffer }> {
    const { client, bucket } = await this.connect();
    const prefix = this.prefix(agentId);

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
      filename: `agent-${agentId}.zip`,
      buffer: Buffer.concat(chunks),
    };
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

  private assertWritableExt(path: string): void {
    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
    if (!ALLOWED_WRITE_EXT.has(ext)) {
      throw new BadRequestException(
        `Only ${[...ALLOWED_WRITE_EXT].join(', ')} files can be edited`,
      );
    }
  }

  private contentType(path: string): string {
    if (path.endsWith('.json')) return 'application/json; charset=utf-8';
    if (path.endsWith('.md')) return 'text/markdown; charset=utf-8';
    return 'text/plain; charset=utf-8';
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
