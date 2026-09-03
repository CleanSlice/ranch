import { Writable } from 'stream';
import * as unzipper from 'unzipper';
import { parse } from 'yaml';
import {
  EXPORT_MANIFEST_NAME,
  entryNameFor,
  writeSourceArchive,
} from './sourceArchive.writer';
import { isIngestableEntry } from './archive.extractor';
import { ISourceData } from '../domain/source.types';

function makeSource(over: Partial<ISourceData> = {}): ISourceData {
  return {
    id: 'source-1',
    knowledgeId: 'knowledge-1',
    type: 'file',
    name: 'manual.md',
    url: 's3://bucket/key',
    mimeType: 'text/markdown',
    content: null,
    sizeBytes: 10,
    indexed: true,
    indexStatus: 'indexed',
    indexState: 'indexed',
    indexError: null,
    indexedAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

function collect(): { out: Writable; done: Promise<Buffer> } {
  const chunks: Buffer[] = [];
  let resolve!: (b: Buffer) => void;
  const done = new Promise<Buffer>((r) => {
    resolve = r;
  });
  const out = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
    final(cb) {
      resolve(Buffer.concat(chunks));
      cb();
    },
  });
  return { out, done };
}

async function zipEntries(zip: Buffer): Promise<Record<string, string>> {
  const dir = await unzipper.Open.buffer(zip);
  const out: Record<string, string> = {};
  for (const file of dir.files) {
    out[file.path] = (await file.buffer()).toString('utf8');
  }
  return out;
}

const readBytes = (s: ISourceData) =>
  Promise.resolve({ body: Buffer.from(`bytes of ${s.id}`) });

describe('entryNameFor', () => {
  it('suffixes a repeated name instead of losing one of them', () => {
    const taken = new Set<string>();
    expect(entryNameFor({ type: 'file', name: 'manual.md' }, taken)).toBe(
      'manual.md',
    );
    // Nothing enforces unique source names, so this is a real collision, not a
    // hypothetical one - and a zip cannot hold two entries with one name.
    expect(entryNameFor({ type: 'file', name: 'manual.md' }, taken)).toBe(
      'manual (2).md',
    );
    expect(entryNameFor({ type: 'file', name: 'manual.md' }, taken)).toBe(
      'manual (3).md',
    );
  });

  it('gives a text source a markdown extension, but does not double one', () => {
    const taken = new Set<string>();
    expect(entryNameFor({ type: 'text', name: 'notes' }, taken)).toBe(
      'notes.md',
    );
    expect(entryNameFor({ type: 'text', name: 'other.md' }, taken)).toBe(
      'other.md',
    );
  });
});

describe('writeSourceArchive', () => {
  it('writes file and text sources as entries and lists them in the manifest', async () => {
    const { out, done } = collect();
    await writeSourceArchive(
      'knowledge-1',
      [
        makeSource({ id: 'a', name: 'manual.md' }),
        makeSource({ id: 'b', type: 'text', name: 'notes', content: 'hi' }),
      ],
      readBytes,
      out,
    );

    const entries = await zipEntries(await done);
    expect(Object.keys(entries).sort()).toEqual([
      EXPORT_MANIFEST_NAME,
      'manual.md',
      'notes.md',
    ]);
    expect(entries['manual.md']).toBe('bytes of a');

    const manifest = parse(entries[EXPORT_MANIFEST_NAME]) as {
      knowledgeId: string;
      sources: { name: string; type: string; entry?: string }[];
    };
    expect(manifest.knowledgeId).toBe('knowledge-1');
    expect(manifest.sources).toEqual([
      { name: 'manual.md', type: 'file', entry: 'manual.md' },
      { name: 'notes', type: 'text', entry: 'notes.md' },
    ]);
  });

  it('records url sources in the manifest without inventing a file for them', async () => {
    const { out, done } = collect();
    await writeSourceArchive(
      'knowledge-1',
      [
        makeSource({
          id: 'u',
          type: 'url',
          name: 'Pricing page',
          url: 'https://example.com/pricing',
        }),
      ],
      () => Promise.reject(new Error('url sources must not be read')),
      out,
    );

    const entries = await zipEntries(await done);
    expect(Object.keys(entries)).toEqual([EXPORT_MANIFEST_NAME]);
    const manifest = parse(entries[EXPORT_MANIFEST_NAME]) as {
      sources: { url?: string }[];
    };
    expect(manifest.sources[0].url).toBe('https://example.com/pricing');
  });

  it('names the manifest so re-importing the zip skips it', () => {
    // Checked against the importer's own predicate, not a copy of its
    // extension list: the round trip only holds while these two agree, and a
    // duplicated list would drift silently.
    expect(isIngestableEntry(EXPORT_MANIFEST_NAME, 1024)).toBe(false);
  });
});
