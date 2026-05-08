import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { IPaddockScenarioGateway } from './scenario.gateway';
import {
  ICreatePaddockScenarioData,
  IPaddockScenarioMessage,
  IPaddockSuccessCriterion,
  IPaddockScenarioSetup,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from './scenario.types';

const SCENARIO_CATEGORIES: PaddockScenarioCategory[] = [
  'tool_use',
  'memory',
  'conversation',
  'patching_workflow',
  'edge_case',
  'multi_turn',
  'error_recovery',
];
const SCENARIO_DIFFICULTIES: PaddockScenarioDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'adversarial',
];

export interface ISeedFromDirOptions {
  // If true, delete existing template-scoped scenarios before seeding.
  // Used by upgrade flows so removed YAMLs disappear from DB.
  wipeExisting?: boolean;
}

export interface ISeedFromDirResult {
  seeded: number;
  skipped: number;
  total: number;
}

// Shared paddock-scenario seeder used by both rancher (boot-time) and
// templateInstall (zip install). Walks `dir` for `.yml`/`.yaml` files,
// parses + validates, and inserts as template-scoped rows.
@Injectable()
export class PaddockScenarioService {
  private readonly logger = new Logger(PaddockScenarioService.name);

  constructor(private readonly scenarioGateway: IPaddockScenarioGateway) {}

  async seedFromDir(
    templateId: string,
    dir: string,
    options: ISeedFromDirOptions = {},
  ): Promise<ISeedFromDirResult> {
    if (!(await this.dirExists(dir))) {
      return { seeded: 0, skipped: 0, total: 0 };
    }

    if (options.wipeExisting) {
      const existing = await this.scenarioGateway.findAll({ templateId });
      for (const s of existing) await this.scenarioGateway.delete(s.id);
    }

    const files = await this.collectYamlFiles(dir);
    let seeded = 0;
    let skipped = 0;
    for (const file of files) {
      const rel = path.relative(dir, file);
      try {
        const yamlSrc = await fs.readFile(file, 'utf8');
        const parsed = parseYaml(yamlSrc) as Record<string, unknown> | null;
        const data = this.toScenarioData(parsed, templateId, rel);
        if (!data) {
          skipped++;
          this.logger.warn(`Scenario ${rel}: invalid shape — skipped`);
          continue;
        }
        await this.scenarioGateway.create(data);
        seeded++;
      } catch (err) {
        skipped++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Scenario ${rel}: ${msg} — skipped`);
      }
    }

    this.logger.log(
      `Seeded ${seeded}/${files.length} paddock scenarios into template ${templateId} from ${dir}`,
    );
    return { seeded, skipped, total: files.length };
  }

  // Public — exposed so callers can validate manifest scenarios before
  // committing (used by templateInstall preview).
  toScenarioData(
    raw: Record<string, unknown> | null,
    templateId: string,
    relPath: string,
  ): ICreatePaddockScenarioData | null {
    if (!raw || typeof raw !== 'object') return null;

    // Category: prefer explicit, fall back to top-level subfolder of relPath
    // (e.g. `conversation/greeting.yml` → `conversation`). This makes folder
    // organisation count without forcing every YAML to repeat itself.
    let category = raw.category as string | undefined;
    if (
      typeof category !== 'string' ||
      !SCENARIO_CATEGORIES.includes(category as PaddockScenarioCategory)
    ) {
      const fallback = relPath.split(path.sep)[0];
      if (SCENARIO_CATEGORIES.includes(fallback as PaddockScenarioCategory)) {
        category = fallback;
      } else {
        return null;
      }
    }

    const difficulty = (raw.difficulty as string | undefined) ?? 'easy';
    if (
      !SCENARIO_DIFFICULTIES.includes(difficulty as PaddockScenarioDifficulty)
    ) {
      return null;
    }

    const name =
      typeof raw.name === 'string' && raw.name.length > 0
        ? raw.name
        : path.basename(relPath, path.extname(relPath));

    const description =
      typeof raw.description === 'string' ? raw.description : '';
    const expectedBehavior =
      typeof raw.expectedBehavior === 'string' ? raw.expectedBehavior : '';

    if (!Array.isArray(raw.messages) || raw.messages.length === 0) return null;
    if (
      !Array.isArray(raw.successCriteria) ||
      raw.successCriteria.length === 0
    ) {
      return null;
    }

    return {
      templateId,
      category: category as PaddockScenarioCategory,
      difficulty: difficulty as PaddockScenarioDifficulty,
      name,
      description,
      expectedBehavior,
      messages: raw.messages as IPaddockScenarioMessage[],
      successCriteria: raw.successCriteria as IPaddockSuccessCriterion[],
      setup: (raw.setup as IPaddockScenarioSetup | null) ?? null,
    };
  }

  private async collectYamlFiles(rootDir: string): Promise<string[]> {
    const out: string[] = [];
    const stack = [rootDir];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile() && /\.ya?ml$/i.test(e.name)) out.push(abs);
      }
    }
    return out;
  }

  private async dirExists(p: string): Promise<boolean> {
    try {
      const s = await fs.stat(p);
      return s.isDirectory();
    } catch {
      return false;
    }
  }
}
