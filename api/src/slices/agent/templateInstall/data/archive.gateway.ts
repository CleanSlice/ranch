import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { Readable } from 'stream';
import * as unzipper from 'unzipper';
import { IArchiveGateway } from '../domain/archive.gateway';
import { IExtractedArchive } from '../domain/templateInstall.types';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_FILE_COUNT = 5000;

@Injectable()
export class ArchiveGateway extends IArchiveGateway {
  async extractZip(zip: Buffer): Promise<IExtractedArchive> {
    if (zip.length > MAX_ARCHIVE_BYTES) {
      throw new BadRequestException(
        `archive: exceeds ${MAX_ARCHIVE_BYTES} bytes (${zip.length})`,
      );
    }

    const id = crypto.randomBytes(8).toString('hex');
    const rootDir = path.join(os.tmpdir(), `ranch-template-install-${id}`);
    await fs.mkdir(rootDir, { recursive: true });

    let totalUncompressed = 0;
    let fileCount = 0;

    const cleanup = async (): Promise<void> => {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
      const directory = await unzipper.Open.buffer(zip);
      for (const entry of directory.files) {
        if (entry.type !== 'File') continue;
        if (++fileCount > MAX_FILE_COUNT) {
          throw new BadRequestException(
            `archive: too many entries (>${MAX_FILE_COUNT})`,
          );
        }

        const safeRel = this.sanitizeEntryPath(entry.path);
        const destPath = path.join(rootDir, safeRel);

        // Defence in depth: even after sanitization, verify dest is inside
        // the staging dir.
        const resolved = path.resolve(destPath);
        const rootResolved = path.resolve(rootDir);
        if (!resolved.startsWith(rootResolved + path.sep)) {
          throw new BadRequestException(
            `archive: path traversal detected (${entry.path})`,
          );
        }

        await fs.mkdir(path.dirname(destPath), { recursive: true });

        const stream = entry.stream() as unknown as Readable;
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => {
            totalUncompressed += chunk.length;
            if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
              reject(
                new BadRequestException(
                  `archive: uncompressed size exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes`,
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => resolve());
          stream.on('error', (err) => reject(err));
        });
        await fs.writeFile(destPath, Buffer.concat(chunks));
      }
    } catch (err) {
      await cleanup();
      throw err;
    }

    return { rootDir, cleanup };
  }

  private sanitizeEntryPath(entryPath: string): string {
    // Reject absolute and traversal paths up front.
    if (path.isAbsolute(entryPath)) {
      throw new BadRequestException(
        `archive: absolute path not allowed (${entryPath})`,
      );
    }
    const norm = path.posix.normalize(entryPath.replace(/\\/g, '/'));
    if (norm.startsWith('..') || norm.includes('/../')) {
      throw new BadRequestException(
        `archive: path traversal not allowed (${entryPath})`,
      );
    }
    if (norm.startsWith('/')) {
      throw new BadRequestException(
        `archive: rooted path not allowed (${entryPath})`,
      );
    }
    return norm;
  }
}
