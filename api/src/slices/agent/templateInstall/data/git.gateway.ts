import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { IGitGateway } from '../domain/git.gateway';
import { IExtractedArchive } from '../domain/templateInstall.types';

const CLONE_TIMEOUT_MS = 60_000; // 1 minute — git clone of a small repo
// Allow standard git transports only. ssh requires keys configured on the
// host; https is the common path.
const URL_PATTERN = /^(https?:\/\/|git@|ssh:\/\/)/;
// Reject URLs that contain shell-meta or look like local file refs.
const URL_BLOCKLIST = /[`$;&|<>]|^file:\/\/|^\.\.?\//;
// Refs may be branches, tags, or short SHAs — reject anything else.
const REF_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/;

@Injectable()
export class GitGateway extends IGitGateway {
  private readonly logger = new Logger(GitGateway.name);

  async clone(url: string, ref?: string): Promise<IExtractedArchive> {
    this.validate(url, ref);

    const id = crypto.randomBytes(8).toString('hex');
    const rootDir = path.join(os.tmpdir(), `ranch-template-git-${id}`);
    await fs.mkdir(rootDir, { recursive: true });

    const cleanup = async (): Promise<void> => {
      await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
      const args = [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        ...(ref ? ['--branch', ref] : []),
        url,
        rootDir,
      ];
      await this.runGit(args);
      // Drop the `.git` directory — it's noise for our pipeline and would be
      // included in the file walker downstream.
      await fs.rm(path.join(rootDir, '.git'), {
        recursive: true,
        force: true,
      });
    } catch (err) {
      await cleanup();
      throw err;
    }

    return { rootDir, cleanup };
  }

  private validate(url: string, ref?: string): void {
    if (typeof url !== 'string' || url.length === 0) {
      throw new BadRequestException('gitUrl is required');
    }
    if (url.length > 1000) {
      throw new BadRequestException('gitUrl too long');
    }
    if (URL_BLOCKLIST.test(url)) {
      throw new BadRequestException('gitUrl contains forbidden characters');
    }
    if (!URL_PATTERN.test(url)) {
      throw new BadRequestException(
        'gitUrl must start with https://, http://, git@, or ssh://',
      );
    }
    if (ref !== undefined && !REF_PATTERN.test(ref)) {
      throw new BadRequestException(
        'gitRef must be alphanumeric with ./- (branch, tag, or short SHA)',
      );
    }
  }

  // Spawn git as an argv array (no shell), so URL/ref values cannot inject
  // shell commands even if validation slips. Times out hard at CLONE_TIMEOUT_MS.
  private runGit(args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn('git', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0', // never prompt for credentials
          GIT_ASKPASS: 'echo',
        },
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
      });

      const timeoutHandle = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new BadRequestException(
            `git clone timed out after ${CLONE_TIMEOUT_MS}ms`,
          ),
        );
      }, CLONE_TIMEOUT_MS);

      child.on('error', (err) => {
        clearTimeout(timeoutHandle);
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new BadRequestException(
              'git binary not found on the api host — install git or use zip upload instead',
            ),
          );
          return;
        }
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeoutHandle);
        if (code === 0) {
          resolve();
          return;
        }
        const trimmed = stderr.trim().slice(0, 500);
        reject(
          new BadRequestException(
            `git clone failed (exit ${code}): ${trimmed || 'unknown error'}`,
          ),
        );
      });
    });
  }
}
