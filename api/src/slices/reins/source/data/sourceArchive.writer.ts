// @scope:api
// @slice:reins/source
// @layer:data
// @type:utility

import * as archiver from 'archiver';
import * as path from 'path';
import { Readable, Writable } from 'stream';
import { stringify } from 'yaml';
import { ISourceData } from '../domain/source.types';

/**
 * Sits at the zip root and describes what was exported. The extension is load
 * bearing: `.yaml` is not in the importer's supported list, so re-uploading an
 * exported zip through `from-archive` skips this file instead of turning the
 * manifest into a source. `sourceArchive.writer.spec.ts` pins that against
 * `isIngestableEntry` itself rather than a copy of the list.
 */
export const EXPORT_MANIFEST_NAME = '_ranch-export.yaml';

/** Text sources have no extension of their own; they land as markdown. */
const TEXT_EXTENSION = '.md';

export interface ISourceBytes {
  /** Consumed exactly once by the archiver. */
  body: Readable | Buffer;
}

export type SourceReader = (source: ISourceData) => Promise<ISourceBytes>;

/**
 * The name a source takes inside the zip, made unique against everything
 * already placed. Two sources can legitimately share a name - nothing enforces
 * uniqueness on create - and a zip cannot hold both, so the later one gets a
 * ` (2)` before its extension the way a file manager would.
 */
export function entryNameFor(
  source: Pick<ISourceData, 'type' | 'name'>,
  taken: Set<string>,
): string {
  const base =
    source.type === 'text' && path.extname(source.name) === ''
      ? `${source.name}${TEXT_EXTENSION}`
      : source.name;

  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }

  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

interface IManifestEntry {
  name: string;
  type: string;
  entry?: string;
  url?: string;
}

export function buildManifest(
  knowledgeId: string,
  entries: readonly IManifestEntry[],
): string {
  return stringify({
    knowledgeId,
    exportedSources: entries.length,
    // No timestamp on purpose: it would make two exports of the same base
    // differ byte for byte, which breaks the "did anything change" check
    // people reach for when a migration looks wrong.
    sources: entries,
  });
}

/**
 * Streams the selected sources into `out` as a zip.
 *
 * One source is read at a time and handed straight to the archiver, so peak
 * memory is one source rather than the whole base - the same discipline the
 * archive *importer* follows. `url` sources have no bytes and appear only in
 * the manifest.
 */
export async function writeSourceArchive(
  knowledgeId: string,
  sources: readonly ISourceData[],
  read: SourceReader,
  out: Writable,
): Promise<void> {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const finished = new Promise<void>((resolve, reject) => {
    archive.on('error', reject);
    out.on('error', reject);
    out.on('close', resolve);
    out.on('finish', resolve);
  });
  archive.pipe(out);

  const taken = new Set<string>();
  const manifest: IManifestEntry[] = [];

  for (const source of sources) {
    if (source.type === 'url') {
      manifest.push({
        name: source.name,
        type: source.type,
        url: source.url ?? '',
      });
      continue;
    }

    const entry = entryNameFor(source, taken);
    const { body } = await read(source);
    archive.append(body, { name: entry });
    manifest.push({ name: source.name, type: source.type, entry });
  }

  archive.append(buildManifest(knowledgeId, manifest), {
    name: EXPORT_MANIFEST_NAME,
  });

  await archive.finalize();
  await finished;
}
