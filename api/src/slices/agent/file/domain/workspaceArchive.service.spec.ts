import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as JSZip from 'jszip';
import { IFileGateway } from './file.gateway';
import { IMPORT_MAX_ENTRIES } from './file.limits';
import { IArchiveEntry } from './import.types';
import { WorkspaceArchiveService } from './workspaceArchive.service';

// ── helpers ─────────────────────────────────────────────────────

type Files = Record<string, string | Buffer>;

async function zipOf(
  files: Files,
  tweak?: (zip: JSZip) => void,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const [path, body] of Object.entries(files)) zip.file(path, body);
  tweak?.(zip);
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
}

const md5 = (s: string | Buffer): string =>
  crypto.createHash('md5').update(s).digest('hex');

interface Stored {
  path: string;
  size: number;
  etag: string;
}

function fakeGateway(stored: Stored[] = []) {
  const puts: string[] = [];
  const deletes: string[] = [];
  const failing = new Set<string>();
  const gateway = {
    listWithEtags: jest.fn(async () => stored),
    putObjectRaw: jest.fn(async (_a: string, path: string) => {
      if (failing.has(path)) throw new Error(`boom ${path}`);
      puts.push(path);
    }),
    delete: jest.fn(async (_a: string, path: string) => {
      deletes.push(path);
    }),
  } as unknown as IFileGateway;
  return { gateway, puts, deletes, failing };
}

const entry = (path: string, body: string): IArchiveEntry => ({
  path,
  size: Buffer.byteLength(body),
  md5: md5(body),
  bytes: Buffer.from(body),
});

// ── validate ────────────────────────────────────────────────────

describe('WorkspaceArchiveService.validate', () => {
  const service = new WorkspaceArchiveService(fakeGateway().gateway);

  it('reads every file entry with its size and md5', async () => {
    const zip = await zipOf({ 'SOUL.md': 'hi', 'skills/run.py': 'print(1)' });
    const { entries, wrapperStripped } = await service.validate(zip);
    expect(wrapperStripped).toBeNull();
    expect(entries.map((e) => e.path).sort()).toEqual(['SOUL.md', 'skills/run.py']);
    const soul = entries.find((e) => e.path === 'SOUL.md')!;
    expect(soul.size).toBe(2);
    expect(soul.md5).toBe(md5('hi'));
    expect(soul.bytes.toString()).toBe('hi');
  });

  it('strips a single wrapping folder', async () => {
    const zip = await zipOf({
      'agent-x/SOUL.md': 'a',
      'agent-x/memory/2026.md': 'b',
    });
    const { entries, wrapperStripped } = await service.validate(zip);
    expect(wrapperStripped).toBe('agent-x');
    expect(entries.map((e) => e.path).sort()).toEqual(['SOUL.md', 'memory/2026.md']);
  });

  it('does not strip when a root file sits beside the folder', async () => {
    const zip = await zipOf({ 'data/x.md': 'a', 'SOUL.md': 'b' });
    const { entries, wrapperStripped } = await service.validate(zip);
    expect(wrapperStripped).toBeNull();
    expect(entries.map((e) => e.path).sort()).toEqual(['SOUL.md', 'data/x.md']);
  });

  it('never treats a workspace folder as a wrapper', async () => {
    const zip = await zipOf({ 'skills/a/SKILL.md': 'a', 'skills/b/SKILL.md': 'b' });
    const { entries, wrapperStripped } = await service.validate(zip);
    expect(wrapperStripped).toBeNull();
    expect(entries.map((e) => e.path).sort()).toEqual(['skills/a/SKILL.md', 'skills/b/SKILL.md']);
  });

  it('does not strip when two top-level folders exist', async () => {
    const zip = await zipOf({ 'data/x.md': 'a', 'memory/y.md': 'b' });
    const { wrapperStripped } = await service.validate(zip);
    expect(wrapperStripped).toBeNull();
  });

  it('skips directory entries instead of refusing them', async () => {
    const zip = await zipOf({ 'data/x.md': 'a' }, (z) => z.folder('empty'));
    const { entries } = await service.validate(zip);
    expect(entries.map((e) => e.path)).toEqual(['data/x.md']);
  });

  it('refuses something that is not a zip', async () => {
    await expect(service.validate(Buffer.from('nope'))).rejects.toThrow(
      /not a zip/,
    );
  });

  it('refuses an empty archive', async () => {
    const zip = await zipOf({});
    await expect(service.validate(zip)).rejects.toThrow(/no files/);
  });

  it('refuses path traversal and names the entry', async () => {
    const zip = await zipOf({ '../evil.md': 'x' });
    await expect(service.validate(zip)).rejects.toThrow(/traversal.*evil\.md/);
  });

  it('refuses an absolute path', async () => {
    const zip = await zipOf({ '/etc/passwd': 'x' });
    await expect(service.validate(zip)).rejects.toThrow(/absolute/);
  });

  it('refuses a drive-letter path', async () => {
    const zip = await zipOf({ 'C:\\win\\x.md': 'x' });
    await expect(service.validate(zip)).rejects.toThrow(/absolute/);
  });

  it('normalises backslashes', async () => {
    const zip = await zipOf({ 'data\\notes.md': 'x' });
    const { entries } = await service.validate(zip);
    expect(entries[0].path).toBe('data/notes.md');
  });

  it('refuses paths that differ only by case', async () => {
    const zip = await zipOf({ 'SOUL.md': 'a', 'soul.md': 'b' });
    await expect(service.validate(zip)).rejects.toThrow(/differ only by case/);
  });

  it('refuses a symbolic link', async () => {
    const zip = await zipOf({ 'data/x.md': 'a' }, (z) => {
      z.file('link', 'target', { unixPermissions: 0o120777 });
    });
    await expect(service.validate(zip)).rejects.toThrow(/symbolic link.*link/);
  });

  it('refuses too many entries', async () => {
    const files: Files = {};
    for (let i = 0; i <= IMPORT_MAX_ENTRIES; i++) files[`f${i}.txt`] = '';
    const zip = await zipOf(files);
    await expect(service.validate(zip)).rejects.toThrow(/too many entries/);
  }, 30_000);

  it('refuses an archive over the compressed limit without parsing it', async () => {
    const big = Buffer.alloc(100 * 1024 * 1024 + 1);
    await expect(service.validate(big)).rejects.toThrow(/exceeds/);
  });

  it('refuses an entry over the per-file limit', async () => {
    const zip = await zipOf({ 'big.bin': Buffer.alloc(25 * 1024 * 1024 + 1) });
    await expect(service.validate(zip)).rejects.toThrow(/big\.bin exceeds/);
  }, 60_000);

  it('throws BadRequestException, never a bare error', async () => {
    const zip = await zipOf({ '../x': 'x' });
    await expect(service.validate(zip)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

// ── plan ────────────────────────────────────────────────────────

describe('WorkspaceArchiveService.plan', () => {
  const stored: Stored[] = [
    { path: 'SOUL.md', size: 4, etag: md5('same') },
    { path: 'agent.config.json', size: 2, etag: md5('{}') },
    { path: 'workspace/old.txt', size: 3, etag: md5('old') },
    { path: 'data/sessions/bridle:admin.jsonl', size: 3, etag: md5('log') },
    { path: 'workspace/multi.bin', size: 9, etag: 'abc-2' },
  ];
  const entries: IArchiveEntry[] = [
    entry('SOUL.md', 'same'),
    entry('agent.config.json', '{"a":1}'),
    entry('skills/new.py', 'print()'),
    entry('data/sessions/bridle:admin.jsonl', 'other'),
    entry('sessions/x.jsonl', 'y'),
    entry('workspace/multi.bin', 'whatever!'),
  ];

  it('classifies add / change / unchanged / skip in merge mode', async () => {
    const { gateway } = fakeGateway(stored);
    const service = new WorkspaceArchiveService(gateway);
    const plan = await service.plan(
      'a1',
      entries,
      { mode: 'merge', includeSessions: false },
      { importId: 'imp', wrapperStripped: 'wrap' },
    );
    const by = Object.fromEntries(plan.entries.map((e) => [e.path, e.action]));
    expect(by).toEqual({
      'SOUL.md': 'unchanged',
      'agent.config.json': 'change',
      'skills/new.py': 'add',
      'data/sessions/bridle:admin.jsonl': 'skip',
      'sessions/x.jsonl': 'skip',
      'workspace/multi.bin': 'change',
    });
    expect(plan.counts).toEqual({ add: 1, change: 2, unchanged: 1, remove: 0, skip: 2 });
    expect(plan.totalBytes).toBe(
      Buffer.byteLength('{"a":1}') + Buffer.byteLength('print()') + Buffer.byteLength('whatever!'),
    );
    expect(plan.importId).toBe('imp');
    expect(plan.wrapperStripped).toBe('wrap');
    expect(plan.mode).toBe('merge');
    expect(plan.more).toBe(0);
    expect(plan.warnings).toEqual(['1 file use multipart ETags — treated as changed']);
  });

  it('includes session files when asked', async () => {
    const service = new WorkspaceArchiveService(fakeGateway(stored).gateway);
    const plan = await service.plan('a1', entries, { mode: 'merge', includeSessions: true });
    const by = Object.fromEntries(plan.entries.map((e) => [e.path, e.action]));
    expect(by['data/sessions/bridle:admin.jsonl']).toBe('change');
    expect(by['sessions/x.jsonl']).toBe('add');
    expect(plan.counts.skip).toBe(0);
  });

  it('lists removals in replace mode, sparing runtime state unless included', async () => {
    const service = new WorkspaceArchiveService(fakeGateway(stored).gateway);
    const plan = await service.plan('a1', entries, { mode: 'replace', includeSessions: false });
    const removes = plan.entries.filter((e) => e.action === 'remove').map((e) => e.path);
    expect(removes).toEqual(['workspace/old.txt']);
    expect(plan.counts.remove).toBe(1);
  });

  it('never removes in merge mode', async () => {
    const service = new WorkspaceArchiveService(fakeGateway(stored).gateway);
    const plan = await service.plan('a1', entries, { mode: 'merge', includeSessions: false });
    expect(plan.entries.some((e) => e.action === 'remove')).toBe(false);
  });

  it('lists the gateway once per plan', async () => {
    const { gateway } = fakeGateway(stored);
    const service = new WorkspaceArchiveService(gateway);
    await service.plan('a1', entries, { mode: 'merge', includeSessions: false });
    expect(gateway.listWithEtags).toHaveBeenCalledTimes(1);
  });
});

// ── apply ───────────────────────────────────────────────────────

describe('WorkspaceArchiveService.apply', () => {
  const stored: Stored[] = [
    { path: 'SOUL.md', size: 4, etag: md5('same') },
    { path: 'workspace/old.txt', size: 3, etag: md5('old') },
  ];
  const entries: IArchiveEntry[] = [
    entry('SOUL.md', 'same'),
    entry('skills/new.py', 'print()'),
    entry('memory/a.md', 'a'),
    entry('sessions/x.jsonl', 'y'),
  ];

  it('writes add/change, skips unchanged and sessions, removes in replace mode', async () => {
    const { gateway, puts, deletes } = fakeGateway(stored);
    const service = new WorkspaceArchiveService(gateway);
    const plan = await service.plan('a1', entries, { mode: 'replace', includeSessions: false }, { importId: 'imp' });
    const result = await service.apply('a1', entries, plan);
    expect(puts.sort()).toEqual(['memory/a.md', 'skills/new.py']);
    expect(deletes).toEqual(['workspace/old.txt']);
    expect(result).toEqual({
      importId: 'imp',
      mode: 'replace',
      written: 2,
      removed: 1,
      skipped: 1,
      failed: [],
      restartRequired: false,
    });
  });

  it('records a failing put instead of throwing', async () => {
    const { gateway, puts, failing } = fakeGateway(stored);
    failing.add('skills/new.py');
    const service = new WorkspaceArchiveService(gateway);
    const plan = await service.plan('a1', entries, { mode: 'merge', includeSessions: false });
    const result = await service.apply('a1', entries, plan);
    expect(puts).toEqual(['memory/a.md']);
    expect(result.written).toBe(1);
    expect(result.failed).toEqual([{ path: 'skills/new.py', reason: 'boom skills/new.py' }]);
  });

  it('writes nothing for an all-unchanged merge', async () => {
    const { gateway, puts, deletes } = fakeGateway(stored);
    const service = new WorkspaceArchiveService(gateway);
    const only = [entry('SOUL.md', 'same')];
    const plan = await service.plan('a1', only, { mode: 'merge', includeSessions: false });
    const result = await service.apply('a1', only, plan);
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
    expect(result.written).toBe(0);
  });
});
