import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as YAML from 'yaml';
import { ITemplateGateway } from '#/agent/template/domain';
import { ITemplateFileGateway } from '#/agent/templateFile/domain';
import { IMcpServerGateway } from '#/mcpServer/domain/mcpServer.gateway';
import { ISkillGateway } from '#/skill/domain/skill.gateway';
import { IPaddockScenarioGateway } from '#/paddock/scenario/domain/scenario.gateway';
import {
  ICreatePaddockScenarioData,
  IPaddockScenarioMessage,
  IPaddockSuccessCriterion,
  IPaddockScenarioSetup,
  PaddockScenarioCategory,
  PaddockScenarioDifficulty,
} from '#/paddock/scenario/domain/scenario.types';
import { IManifestGateway } from './manifest.gateway';
import { IArchiveGateway } from './archive.gateway';
import {
  IManifest,
  IInstallParamValues,
  IInstallPreview,
  IInstallResult,
  IExtractedArchive,
} from './templateInstall.types';

const DEFAULT_IMAGE = 'ghcr.io/cleanslice/runtime:latest';
const DEFAULT_RESOURCES = { cpu: '500m', memory: '512Mi' };

// Files in `.agent/` whose contents are rendered against params.
// Binary files would be skipped — the default template ships only text.
const RENDERABLE_EXTENSIONS = new Set([
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.txt',
]);

@Injectable()
export class TemplateInstallService {
  private readonly logger = new Logger(TemplateInstallService.name);

  constructor(
    private readonly archiveGateway: IArchiveGateway,
    private readonly manifestGateway: IManifestGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly templateFileGateway: ITemplateFileGateway,
    private readonly mcpServerGateway: IMcpServerGateway,
    private readonly skillGateway: ISkillGateway,
    private readonly scenarioGateway: IPaddockScenarioGateway,
  ) {}

  async preview(
    zip: Buffer,
    suppliedParams: IInstallParamValues,
  ): Promise<IInstallPreview> {
    const archive = await this.archiveGateway.extractZip(zip);
    try {
      const { manifest, agentDir, scenariosDir } =
        await this.parseFromArchive(archive);
      this.manifestGateway.validateParams(manifest, suppliedParams);

      const existing = await this.templateGateway.findById(manifest.metadata.id);
      const warnings = await this.collectWarnings(manifest, existing);

      const [agentFiles, scenarioFiles] = await Promise.all([
        this.countFiles(agentDir),
        scenariosDir ? this.countFiles(scenariosDir) : Promise.resolve(0),
      ]);

      const declaredSkills = await Promise.all(
        (manifest.skills ?? []).map(async (s) => ({
          id: s.id,
          resolved: !!(await this.skillGateway.findById(s.id)),
        })),
      );
      const declaredMcp = await Promise.all(
        (manifest.mcp ?? []).map(async (m) => ({
          id: m.id,
          resolved: !!(await this.mcpServerGateway.findById(m.id)),
        })),
      );

      return {
        manifest,
        willCreate: !existing,
        willUpgrade: !!existing,
        existingTemplateId: existing?.id,
        declared: {
          skills: declaredSkills,
          mcp: declaredMcp,
          secrets: (manifest.secrets ?? []).map((s) => ({
            name: s.name,
            required: s.required ?? true,
          })),
        },
        files: { agentFiles, scenarioFiles },
        warnings,
      };
    } finally {
      await archive.cleanup();
    }
  }

  async install(
    zip: Buffer,
    suppliedParams: IInstallParamValues,
  ): Promise<IInstallResult> {
    const archive = await this.archiveGateway.extractZip(zip);
    try {
      const { manifest, agentDir, scenariosDir } =
        await this.parseFromArchive(archive);
      const params = this.manifestGateway.validateParams(
        manifest,
        suppliedParams,
      );

      const existing = await this.templateGateway.findById(manifest.metadata.id);
      const warnings = await this.collectWarnings(manifest, existing);

      // Same version + already installed → no-op (idempotent).
      if (existing && this.sameVersion(existing, manifest)) {
        return {
          templateId: existing.id,
          templateName: existing.name,
          filesUploaded: 0,
          scenariosSeeded: 0,
          mcpAttached: existing.mcpServerIds,
          skillsAttached: existing.skillIds,
          unresolvedMcp: [],
          unresolvedSkills: [],
          warnings: [
            ...warnings,
            `template ${manifest.metadata.id}@${manifest.metadata.version} already installed — no-op`,
          ],
        };
      }

      // Lower version on top of installed → reject.
      if (existing && this.compareSemver(manifest, existing) < 0) {
        throw new ConflictException(
          `Cannot downgrade template ${manifest.metadata.id} — installed version is newer than ${manifest.metadata.version}`,
        );
      }

      // Create or upgrade
      if (!existing) {
        await this.templateGateway.createWithId({
          id: manifest.metadata.id,
          name: manifest.metadata.name,
          description: manifest.metadata.description,
          image: DEFAULT_IMAGE,
          defaultResources: DEFAULT_RESOURCES,
        });
      } else {
        await this.templateGateway.update(existing.id, {
          name: manifest.metadata.name,
          description: manifest.metadata.description,
        });
      }

      // Files: wipe on upgrade so removed files are actually gone, then
      // upload the rendered set. New install → S3 prefix is empty already.
      if (existing) {
        await this.templateFileGateway.wipe(existing.id);
      }

      const filesUploaded = await this.uploadAgentFiles(
        manifest.metadata.id,
        agentDir,
        scenariosDir,
        params,
      );

      // Resolve skills + attach. Missing → warning; install proceeds.
      const skillRefs = manifest.skills ?? [];
      const resolvedSkills: string[] = [];
      const unresolvedSkills: string[] = [];
      for (const s of skillRefs) {
        const found = await this.skillGateway.findById(s.id);
        if (found) resolvedSkills.push(s.id);
        else unresolvedSkills.push(s.id);
      }
      if (unresolvedSkills.length > 0) {
        warnings.push(
          `Skills not found in registry, skipped: ${unresolvedSkills.join(', ')}`,
        );
      }
      await this.templateGateway.setSkills(manifest.metadata.id, resolvedSkills);

      const mcpRefs = manifest.mcp ?? [];
      const resolvedMcp: string[] = [];
      const unresolvedMcp: string[] = [];
      for (const m of mcpRefs) {
        const found = await this.mcpServerGateway.findById(m.id);
        if (found) resolvedMcp.push(m.id);
        else unresolvedMcp.push(m.id);
      }
      if (unresolvedMcp.length > 0) {
        warnings.push(
          `MCP servers not found in registry, skipped: ${unresolvedMcp.join(', ')}`,
        );
      }
      await this.templateGateway.setMcps(manifest.metadata.id, resolvedMcp);

      // Seed paddock scenarios. Strict-ensure: on upgrade we wipe the
      // existing scenarios for this template first so removed scenarios
      // don't linger.
      const scenariosSeeded = await this.seedScenarios(
        manifest.metadata.id,
        scenariosDir,
        existing !== null,
      );

      return {
        templateId: manifest.metadata.id,
        templateName: manifest.metadata.name,
        filesUploaded,
        scenariosSeeded,
        mcpAttached: resolvedMcp,
        skillsAttached: resolvedSkills,
        unresolvedMcp,
        unresolvedSkills,
        warnings,
      };
    } finally {
      await archive.cleanup();
    }
  }

  // ---- internals ----

  private async parseFromArchive(archive: IExtractedArchive): Promise<{
    manifest: IManifest;
    agentDir: string;
    scenariosDir: string | null;
  }> {
    const manifestPath = await this.locateManifest(archive.rootDir);
    const yamlSource = await fs.readFile(manifestPath, 'utf8');
    const manifest = this.manifestGateway.parse(yamlSource);

    const templateRoot = path.dirname(manifestPath);
    const agentDir = path.resolve(templateRoot, manifest.files.agent);
    const scenariosDir = manifest.files.paddock
      ? path.resolve(templateRoot, manifest.files.paddock, 'scenarios')
      : null;

    if (!(await this.dirExists(agentDir))) {
      throw new BadRequestException(
        `archive: files.agent directory not found at ${manifest.files.agent}`,
      );
    }
    return { manifest, agentDir, scenariosDir };
  }

  // template.yaml may be at archive root, or one level deep (zips of a folder
  // typically contain one top-level dir). We accept both.
  private async locateManifest(rootDir: string): Promise<string> {
    const direct = path.join(rootDir, 'template.yaml');
    if (await this.fileExists(direct)) return direct;

    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1) {
      const nested = path.join(rootDir, dirs[0].name, 'template.yaml');
      if (await this.fileExists(nested)) return nested;
    }
    throw new BadRequestException(
      'archive: template.yaml not found at archive root',
    );
  }

  private async uploadAgentFiles(
    templateId: string,
    agentDir: string,
    scenariosDir: string | null,
    params: IInstallParamValues,
  ): Promise<number> {
    // .agent/* → templateFile prefix, with rendering for text files.
    const agentFiles = await this.collectFiles(agentDir);
    const uploads: { path: string; buffer: Buffer; contentType?: string }[] = [];
    for (const abs of agentFiles) {
      const rel = path.posix.join('.agent', path.relative(agentDir, abs));
      const buffer = await fs.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      const finalBuffer = RENDERABLE_EXTENSIONS.has(ext)
        ? Buffer.from(
            this.manifestGateway.render(buffer.toString('utf8'), params),
            'utf8',
          )
        : buffer;
      uploads.push({ path: rel, buffer: finalBuffer });
    }

    // .paddock/config.json → also stored as a template file (paddock
    // configuration is per-template). Scenario files are NOT uploaded
    // as template files — they are seeded into DB rows by seedScenarios.
    if (scenariosDir) {
      const paddockDir = path.dirname(scenariosDir);
      const paddockConfig = path.join(paddockDir, 'config.json');
      if (await this.fileExists(paddockConfig)) {
        const buffer = await fs.readFile(paddockConfig);
        uploads.push({ path: '.paddock/config.json', buffer });
      }
    }

    if (uploads.length > 0) {
      await this.templateFileGateway.uploadMany(templateId, uploads);
    }
    return uploads.length;
  }

  private async seedScenarios(
    templateId: string,
    scenariosDir: string | null,
    isUpgrade: boolean,
  ): Promise<number> {
    if (!scenariosDir) return 0;
    if (!(await this.dirExists(scenariosDir))) return 0;

    if (isUpgrade) {
      const existing = await this.scenarioGateway.findAll({ templateId });
      for (const s of existing) await this.scenarioGateway.delete(s.id);
    }

    const files = await this.collectFiles(scenariosDir);
    let seeded = 0;
    for (const abs of files) {
      if (!/\.ya?ml$/i.test(abs)) continue;
      const rel = path.relative(scenariosDir, abs);
      // Category = top-level subfolder, e.g. `conversation/greeting.yml` → `conversation`.
      const category = rel.split(path.sep)[0] as PaddockScenarioCategory;
      const yamlSource = await fs.readFile(abs, 'utf8');
      const parsed = YAML.parse(yamlSource) as Record<string, unknown>;
      const data = this.coerceScenario(templateId, category, parsed, rel);
      if (!data) continue;
      try {
        await this.scenarioGateway.create(data);
        seeded++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Skipped scenario ${rel}: ${msg}`);
      }
    }
    return seeded;
  }

  private coerceScenario(
    templateId: string,
    fallbackCategory: PaddockScenarioCategory,
    raw: Record<string, unknown>,
    relPath: string,
  ): ICreatePaddockScenarioData | null {
    const cat = (raw.category as PaddockScenarioCategory) ?? fallbackCategory;
    const diff = (raw.difficulty as PaddockScenarioDifficulty) ?? 'easy';
    const name = (raw.name as string) ?? path.basename(relPath, path.extname(relPath));
    const description = (raw.description as string) ?? '';
    const expectedBehavior = (raw.expectedBehavior as string) ?? '';
    const messages = (raw.messages as IPaddockScenarioMessage[]) ?? [];
    const successCriteria =
      (raw.successCriteria as IPaddockSuccessCriterion[]) ?? [];

    if (!Array.isArray(messages) || messages.length === 0) {
      this.logger.warn(`Scenario ${relPath}: no messages — skipped`);
      return null;
    }
    if (!Array.isArray(successCriteria) || successCriteria.length === 0) {
      this.logger.warn(`Scenario ${relPath}: no successCriteria — skipped`);
      return null;
    }

    return {
      templateId,
      category: cat,
      difficulty: diff,
      name,
      description,
      expectedBehavior,
      messages,
      successCriteria,
      setup: (raw.setup as IPaddockScenarioSetup | null) ?? null,
    };
  }

  private async collectWarnings(
    manifest: IManifest,
    existing: { id: string } | null,
  ): Promise<string[]> {
    const warnings: string[] = [];
    const req = manifest.requirements?.ranchRuntime;
    if (req && !this.runtimeSatisfies(req)) {
      warnings.push(
        `Manifest requires ranchRuntime "${req}" — current runtime may not satisfy this. Install will proceed; verify compatibility manually.`,
      );
    }
    if (existing) {
      warnings.push(
        `Template "${manifest.metadata.id}" already exists — this will be treated as an upgrade. User-edited managed files may be overwritten.`,
      );
    }
    return warnings;
  }

  // v1: warning-only check. We don't have a strong runtime version source
  // here yet, so this always passes. Hook for phase b.
  private runtimeSatisfies(_range: string): boolean {
    return true;
  }

  private sameVersion(
    existing: { name: string },
    manifest: IManifest,
  ): boolean {
    // Phase a: no version column on Template yet, so use name+id match.
    // Phase b will read existing.version and compare against manifest.metadata.version.
    return existing.name === manifest.metadata.name;
  }

  // Returns -1 if manifest < existing, 0 if equal, 1 if manifest > existing.
  // Phase a: no version column — always returns 0 (treat any re-install as upgrade or no-op).
  private compareSemver(
    _manifest: IManifest,
    _existing: { id: string },
  ): number {
    return 0;
  }

  private async collectFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(abs);
        else if (e.isFile()) out.push(abs);
      }
    }
    return out;
  }

  private async countFiles(root: string): Promise<number> {
    if (!(await this.dirExists(root))) return 0;
    return (await this.collectFiles(root)).length;
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      const s = await fs.stat(p);
      return s.isFile();
    } catch {
      return false;
    }
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
