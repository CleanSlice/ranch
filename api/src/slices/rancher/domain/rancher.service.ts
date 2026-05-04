import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import * as path from 'path';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { parse as parseYaml } from 'yaml';
import { ITemplateGateway, ITemplateData } from '#/agent/template/domain';
import {
  ITemplateFileGateway,
  ITemplateFileUpload,
} from '#/agent/templateFile/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import { ILlmGateway } from '#/llm/domain';
import { ISettingGateway } from '#/setting/domain';
import { IMcpServerGateway } from '#/mcpServer/domain';
import { RANCH_MCP_ID } from '#/mcpServer/domain/mcpServer.seeder';
import {
  IPaddockScenarioGateway,
  ICreatePaddockScenarioData,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from '#/paddock/scenario/domain';
import {
  RANCHER_TEMPLATE_ID,
  RANCHER_TEMPLATE_NAME,
  RANCHER_TEMPLATE_DEFAULTS,
  IRancherStatus,
} from './rancher.types';

const SCENARIO_CATEGORIES: readonly PaddockScenarioCategory[] = [
  'tool_use',
  'memory',
  'conversation',
  'patching_workflow',
  'edge_case',
  'multi_turn',
  'error_recovery',
];

const SCENARIO_DIFFICULTIES: readonly PaddockScenarioDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'adversarial',
];

const SEEDED_HASH_GROUP = 'rancher';
const SEEDED_HASH_NAME = 'seeded_hash';

@Injectable()
export class RancherService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RancherService.name);

  constructor(
    private templateGateway: ITemplateGateway,
    private templateFileGateway: ITemplateFileGateway,
    private agentGateway: IAgentGateway,
    private llmGateway: ILlmGateway,
    private settingGateway: ISettingGateway,
    private mcpServerGateway: IMcpServerGateway,
    private scenarioGateway: IPaddockScenarioGateway,
  ) {}

  // Auto-sync the Rancher template's files + paddock scenarios on every
  // api boot. Compares a content-hash of the local source against the
  // hash recorded after the last successful sync (stored in `settings`):
  //   - hash matches → no-op
  //   - hash differs (new image, edited yml in dev, etc.) → wipe and reseed
  // Skips silently if the template doesn't exist yet — POST /rancher/template
  // will create + seed it on first call.
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncTemplateIfChanged();
    } catch (err) {
      // Best-effort: don't block api startup on a sync failure.
      this.logger.warn(
        `Rancher template auto-sync failed: ${(err as Error).message}`,
      );
    }
  }

  async getStatus(): Promise<IRancherStatus> {
    const [llms, template, admin] = await Promise.all([
      this.llmGateway.findAll(),
      this.templateGateway.findById(RANCHER_TEMPLATE_ID),
      this.agentGateway.findAdmin(),
    ]);
    return {
      hasLlm: llms.some((l) => l.status === 'active'),
      template,
      admin,
    };
  }

  // Idempotent — returns the existing Rancher template if one exists,
  // otherwise creates it with hardcoded defaults and seeds the template
  // filesystem from the local source (rancher/.agent/, etc.). The image
  // override comes from `agent_defaults.image` if the operator set one
  // in Settings.
  async ensureTemplate(): Promise<ITemplateData> {
    const existing = await this.templateGateway.findById(RANCHER_TEMPLATE_ID);
    if (existing) return existing;

    const imageSetting = await this.settingGateway.findByKey(
      'agent_defaults',
      'image',
    );
    const overrideImage =
      typeof imageSetting?.value === 'string' ? imageSetting.value : '';

    await this.templateGateway.createWithId({
      id: RANCHER_TEMPLATE_ID,
      name: RANCHER_TEMPLATE_NAME,
      description: RANCHER_TEMPLATE_DEFAULTS.description,
      image: overrideImage || RANCHER_TEMPLATE_DEFAULTS.image,
      defaultResources: RANCHER_TEMPLATE_DEFAULTS.defaultResources,
    });

    // Auto-attach the built-in Ranch MCP so a freshly created Rancher agent
    // gets ranch_* tools out of the box. The seeder ensures `mcp-ranch` exists
    // before us; on a brand-new ranch where seed hasn't run yet, skip
    // gracefully — operator can attach it later from the template UI.
    let mcpServerIds: string[] = [];
    if (await this.mcpServerGateway.findById(RANCH_MCP_ID)) {
      mcpServerIds = [RANCH_MCP_ID];
    } else {
      this.logger.warn(
        `Ranch MCP (${RANCH_MCP_ID}) not seeded yet — Rancher template created without it. Attach manually in /mcps.`,
      );
    }

    const withMcps = await this.templateGateway.setMcps(
      RANCHER_TEMPLATE_ID,
      mcpServerIds,
    );

    await this.seedTemplateFiles();
    await this.seedTemplateScenarios();
    // Record the source hash so the boot-time sync can tell when source
    // drifts in a future deploy. Null means source dirs were unreachable —
    // fine, the next boot will retry.
    const initialHash = await this.computeSourceHash();
    if (initialHash) await this.storeSourceHash(initialHash);
    return withMcps;
  }

  // Internal — boot-time. Replaces files + scenarios when the local source
  // hash differs from the one stored in settings. Loud about what it does.
  private async syncTemplateIfChanged(): Promise<void> {
    const existing = await this.templateGateway.findById(RANCHER_TEMPLATE_ID);
    if (!existing) return;

    const currentHash = await this.computeSourceHash();
    if (currentHash === null) {
      this.logger.warn(
        'Rancher source hash unavailable (RANCHER_TEMPLATE_DIR / RANCHER_PADDOCK_DIR missing) — skipping auto-sync',
      );
      return;
    }
    const stored = await this.settingGateway.findByKey(
      SEEDED_HASH_GROUP,
      SEEDED_HASH_NAME,
    );
    const storedHash =
      typeof stored?.value === 'string' ? stored.value : null;
    if (storedHash === currentHash) return;

    this.logger.log(
      `Rancher template source hash changed (${storedHash ?? 'none'} → ${currentHash}) — wiping and reseeding files + scenarios`,
    );
    await this.templateFileGateway.wipe(RANCHER_TEMPLATE_ID);
    await this.deleteTemplateScenarios();
    await this.seedTemplateFiles();
    await this.seedTemplateScenarios();
    await this.storeSourceHash(currentHash);
  }

  private async deleteTemplateScenarios(): Promise<void> {
    const scenarios = await this.scenarioGateway.findAll({
      templateId: RANCHER_TEMPLATE_ID,
    });
    for (const s of scenarios) {
      await this.scenarioGateway.delete(s.id);
    }
  }

  private async storeSourceHash(hash: string): Promise<void> {
    await this.settingGateway.upsert(SEEDED_HASH_GROUP, SEEDED_HASH_NAME, {
      value: hash,
      valueType: 'string',
    });
  }

  // SHA-256 of (sorted) {path, contents} entries from the .agent dir and the
  // .paddock/scenarios dir. Returns null if neither dir is reachable —
  // caller treats that as "skip auto-sync, the previous state is fine".
  private async computeSourceHash(): Promise<string | null> {
    const agentDir =
      process.env.RANCHER_TEMPLATE_DIR ??
      path.resolve(process.cwd(), '..', 'rancher', '.agent');
    const paddockDir =
      process.env.RANCHER_PADDOCK_DIR ??
      path.resolve(process.cwd(), '..', 'rancher', '.paddock', 'scenarios');

    const entries: { path: string; sha: string }[] = [];
    let found = false;
    for (const root of [agentDir, paddockDir]) {
      try {
        const files = await this.collectFiles(root);
        for (const f of files) {
          entries.push({
            path: `${path.basename(root)}/${f.path}`,
            sha: createHash('sha256').update(f.buffer).digest('hex'),
          });
        }
        found = true;
      } catch {
        // best-effort; skip missing roots
      }
    }
    if (!found) return null;
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
  }

  // Walks the local `.agent/` folder under rancher/ and uploads every file
  // to the template's S3 prefix WITHOUT the `.agent/` segment. Runtime maps
  // its agent dir directly to the agent's S3 prefix, so paths must be stored
  // relative to `.agent/` (otherwise they end up nested as .agent/.agent/…
  // when the runtime pulls). Best-effort — failures are logged but don't
  // abort template creation.
  private async seedTemplateFiles(): Promise<void> {
    const sourceDir =
      process.env.RANCHER_TEMPLATE_DIR ??
      path.resolve(process.cwd(), '..', 'rancher', '.agent');

    let uploads: ITemplateFileUpload[];
    try {
      uploads = await this.collectFiles(sourceDir);
    } catch (err) {
      this.logger.warn(
        `Rancher template source not found at ${sourceDir}: ${(err as Error).message}`,
      );
      return;
    }

    if (uploads.length === 0) {
      this.logger.warn(`Rancher template source ${sourceDir} is empty`);
      return;
    }

    try {
      await this.templateFileGateway.uploadMany(RANCHER_TEMPLATE_ID, uploads);
      this.logger.log(
        `Seeded ${uploads.length} files into template ${RANCHER_TEMPLATE_ID} from ${sourceDir}`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to seed Rancher template files: ${(err as Error).message}`,
      );
    }
  }

  private async collectFiles(rootDir: string): Promise<ITemplateFileUpload[]> {
    const out: ITemplateFileUpload[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const buffer = await fs.readFile(full);
          const rel = path.relative(rootDir, full).split(path.sep).join('/');
          out.push({ path: rel, buffer });
        }
      }
    };

    await walk(rootDir);
    return out;
  }

  // Walks the local `.paddock/scenarios/` folder under rancher/ and inserts
  // every YAML scenario as template-scoped — every agent created from this
  // template inherits them via `findForAgent` (template defaults + per-agent
  // overrides). Best-effort — failures are logged but don't abort template
  // creation.
  private async seedTemplateScenarios(): Promise<void> {
    const sourceDir =
      process.env.RANCHER_PADDOCK_DIR ??
      path.resolve(process.cwd(), '..', 'rancher', '.paddock', 'scenarios');

    let files: string[];
    try {
      files = await this.collectScenarioFiles(sourceDir);
    } catch (err) {
      this.logger.warn(
        `Rancher paddock scenarios not found at ${sourceDir}: ${(err as Error).message}`,
      );
      return;
    }

    if (files.length === 0) {
      this.logger.warn(`Rancher paddock scenarios dir ${sourceDir} is empty`);
      return;
    }

    let created = 0;
    for (const file of files) {
      try {
        const raw = await fs.readFile(file, 'utf8');
        const parsed = parseYaml(raw) as Record<string, unknown> | null;
        const data = this.toScenarioData(parsed, RANCHER_TEMPLATE_ID);
        if (!data) {
          this.logger.warn(
            `Skipping scenario ${path.relative(sourceDir, file)}: invalid shape`,
          );
          continue;
        }
        await this.scenarioGateway.create(data);
        created++;
      } catch (err) {
        this.logger.warn(
          `Failed to seed scenario ${path.relative(sourceDir, file)}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Seeded ${created}/${files.length} paddock scenarios into template ${RANCHER_TEMPLATE_ID} from ${sourceDir}`,
    );
  }

  private async collectScenarioFiles(rootDir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (
          entry.isFile() &&
          (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))
        ) {
          out.push(full);
        }
      }
    };
    await walk(rootDir);
    return out;
  }

  private toScenarioData(
    raw: Record<string, unknown> | null,
    templateId: string,
  ): ICreatePaddockScenarioData | null {
    if (!raw || typeof raw !== 'object') return null;

    const category = raw.category;
    const difficulty = raw.difficulty;
    if (
      typeof category !== 'string' ||
      !SCENARIO_CATEGORIES.includes(category as PaddockScenarioCategory)
    )
      return null;
    if (
      typeof difficulty !== 'string' ||
      !SCENARIO_DIFFICULTIES.includes(difficulty as PaddockScenarioDifficulty)
    )
      return null;

    const name = raw.name;
    const description = raw.description;
    const expectedBehavior = raw.expectedBehavior;
    if (
      typeof name !== 'string' ||
      typeof description !== 'string' ||
      typeof expectedBehavior !== 'string'
    )
      return null;

    if (!Array.isArray(raw.messages) || !Array.isArray(raw.successCriteria))
      return null;

    return {
      templateId,
      agentId: null,
      category: category as PaddockScenarioCategory,
      difficulty: difficulty as PaddockScenarioDifficulty,
      name,
      description,
      expectedBehavior,
      messages: raw.messages as ICreatePaddockScenarioData['messages'],
      successCriteria:
        raw.successCriteria as ICreatePaddockScenarioData['successCriteria'],
      setup:
        (raw.setup as ICreatePaddockScenarioData['setup']) ?? null,
    };
  }
}
