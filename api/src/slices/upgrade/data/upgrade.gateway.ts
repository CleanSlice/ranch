import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { IUpgradeGateway } from '../domain/upgrade.gateway';
import {
  IUpgradeEligibility,
  IUpgradeResult,
  IUpgradeStage,
} from '../domain/upgrade.types';

const execFileP = promisify(execFile);
const MAX_OUTPUT_BUFFER = 1024 * 1024 * 20;
const ROOT_WALK_DEPTH = 6;

@Injectable()
export class UpgradeGateway extends IUpgradeGateway {
  private readonly logger = new Logger(UpgradeGateway.name);

  private findRanchRoot(): string | null {
    let dir = resolve(process.cwd());
    for (let i = 0; i < ROOT_WALK_DEPTH; i++) {
      const pkg = join(dir, 'package.json');
      if (existsSync(pkg)) {
        try {
          const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as {
            name?: string;
          };
          if (parsed.name === 'ranch') return dir;
        } catch {
          // ignore malformed package.json on the way up
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  private readVersion(root: string): string {
    try {
      const parsed = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ) as { version?: string };
      return parsed.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  private async tryGit(args: string[], cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileP('git', args, {
        cwd,
        maxBuffer: MAX_OUTPUT_BUFFER,
      });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  async checkEligibility(): Promise<IUpgradeEligibility> {
    if (process.env.RANCH_DEPLOYED === '1') {
      return {
        eligible: false,
        reason:
          'Running in deployed mode — in-place upgrade is disabled. Update via CI / k8s instead.',
        currentVersion: process.env.RANCH_VERSION ?? '0.0.0',
      };
    }

    const root = this.findRanchRoot();
    if (!root) {
      return {
        eligible: false,
        reason: 'Could not locate the Ranch checkout root from this process.',
        currentVersion: process.env.RANCH_VERSION ?? '0.0.0',
      };
    }

    const currentVersion = this.readVersion(root);

    if (!existsSync(join(root, '.git'))) {
      return {
        eligible: false,
        reason: 'Not a git checkout — upgrade is unavailable.',
        currentVersion,
      };
    }

    const branch = await this.tryGit(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      root,
    );
    const status = await this.tryGit(['status', '--porcelain'], root);
    const dirty = status.length > 0;

    if (dirty) {
      return {
        eligible: false,
        reason:
          'Uncommitted local changes — commit or stash them before upgrading.',
        currentVersion,
        branch,
        dirty,
      };
    }
    if (branch && branch !== 'main') {
      return {
        eligible: false,
        reason: `On branch '${branch}' — switch to main to upgrade.`,
        currentVersion,
        branch,
        dirty,
      };
    }

    return { eligible: true, currentVersion, branch, dirty };
  }

  async performUpgrade(): Promise<IUpgradeResult> {
    const root = this.findRanchRoot();
    if (!root) {
      throw new Error('Ranch root disappeared between eligibility and run.');
    }
    const versionBefore = this.readVersion(root);
    const stages: IUpgradeStage[] = [];

    const runStage = async (
      name: string,
      cmd: string,
      args: string[],
      cwd: string,
    ): Promise<void> => {
      const startedAt = Date.now();
      this.logger.log(`upgrade stage ${name}: ${cmd} ${args.join(' ')}`);
      try {
        const { stdout, stderr } = await execFileP(cmd, args, {
          cwd,
          maxBuffer: MAX_OUTPUT_BUFFER,
        });
        stages.push({
          name,
          durationMs: Date.now() - startedAt,
          output: (stdout + stderr).slice(-2000),
        });
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        stages.push({
          name,
          durationMs: Date.now() - startedAt,
          output: (
            (e.stdout ?? '') +
            (e.stderr ?? '') +
            (e.message ?? '')
          ).slice(-2000),
        });
        throw err;
      }
    };

    await runStage(
      'git-fetch',
      'git',
      ['fetch', '--prune', 'origin', 'main'],
      root,
    );
    await runStage(
      'git-pull',
      'git',
      ['pull', '--ff-only', 'origin', 'main'],
      root,
    );
    await runStage('bun-install', 'bun', ['install'], root);
    await runStage(
      'prisma-migrate',
      'npx',
      ['prisma', 'migrate', 'deploy'],
      join(root, 'api'),
    );

    const versionAfter = this.readVersion(root);
    return { versionBefore, versionAfter, stages };
  }
}
