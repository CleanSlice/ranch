import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ITemplateGateway,
  ITemplateData,
} from '#/agent/template/domain';
import { ITemplateFileGateway } from '#/agent/templateFile/domain';
import { IMcpServerGateway } from '#/mcpServer/domain/mcpServer.gateway';
import { ISkillGateway } from '#/skill/domain/skill.gateway';
import { PaddockScenarioService } from '#/paddock/scenario/domain/scenario.service';
import { IManifestGateway } from './manifest.gateway';
import { IArchiveGateway } from './archive.gateway';
import { IGitGateway } from './git.gateway';
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
    private readonly gitGateway: IGitGateway,
    private readonly manifestGateway: IManifestGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly templateFileGateway: ITemplateFileGateway,
    private readonly mcpServerGateway: IMcpServerGateway,
    private readonly skillGateway: ISkillGateway,
    private readonly scenarioService: PaddockScenarioService,
  ) {}

  // ===== public entry points =====

  async preview(
    zip: Buffer,
    suppliedParams: IInstallParamValues,
  ): Promise<IInstallPreview> {
    const archive = await this.archiveGateway.extractZip(zip);
    try {
      return await this.previewFromExtracted(archive, suppliedParams);
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
      return await this.installFromExtracted(archive, suppliedParams, {
        sourceType: 'zip',
      });
    } finally {
      await archive.cleanup();
    }
  }

  async previewFromGit(
    url: string,
    ref: string | undefined,
    suppliedParams: IInstallParamValues,
  ): Promise<IInstallPreview> {
    const archive = await this.gitGateway.clone(url, ref);
    try {
      return await this.previewFromExtracted(archive, suppliedParams);
    } finally {
      await archive.cleanup();
    }
  }

  async installFromGit(
    url: string,
    ref: string | undefined,
    suppliedParams: IInstallParamValues,
  ): Promise<IInstallResult> {
    const archive = await this.gitGateway.clone(url, ref);
    try {
      return await this.installFromExtracted(archive, suppliedParams, {
        sourceType: 'git',
        sourceUrl: url,
      });
    } finally {
      await archive.cleanup();
    }
  }

  // ===== shared internals =====

  private async previewFromExtracted(
    archive: IExtractedArchive,
    suppliedParams: IInstallParamValues,
  ): Promise<IInstallPreview> {
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
  }

  private async installFromExtracted(
    archive: IExtractedArchive,
    suppliedParams: IInstallParamValues,
    provenance: { sourceType: 'zip' | 'git'; sourceUrl?: string },
  ): Promise<IInstallResult> {
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
          `Cannot downgrade template ${manifest.metadata.id} — installed version (${existing.version ?? 'unknown'}) is newer than ${manifest.metadata.version}`,
        );
      }

    // Create or upgrade — populate provenance fields so future installs
    // can do real version comparisons and audits.
    const manifestJson = manifest as unknown as Record<string, unknown>;
    const paddockConfig = scenariosDir
      ? await this.readPaddockConfig(scenariosDir)
      : null;
    if (!existing) {
      await this.templateGateway.createWithId({
        id: manifest.metadata.id,
        name: manifest.metadata.name,
        description: manifest.metadata.description,
        image: DEFAULT_IMAGE,
        defaultResources: DEFAULT_RESOURCES,
        sourceType: provenance.sourceType,
        sourceUrl: provenance.sourceUrl,
        version: manifest.metadata.version,
        manifestJson,
        ...(paddockConfig ? { paddockConfig } : {}),
      });
    } else {
      await this.templateGateway.update(existing.id, {
        name: manifest.metadata.name,
        description: manifest.metadata.description,
        version: manifest.metadata.version,
        sourceType: provenance.sourceType,
        sourceUrl: provenance.sourceUrl ?? null,
        manifestJson,
        ...(paddockConfig ? { paddockConfig } : {}),
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

      // Seed paddock scenarios via the shared service.
      // Strict-ensure on upgrade: wipe existing template-scoped scenarios
      // first so removed YAMLs disappear from the DB.
      const seedResult = scenariosDir
        ? await this.scenarioService.seedFromDir(
            manifest.metadata.id,
            scenariosDir,
            { wipeExisting: existing !== null },
          )
        : { seeded: 0, skipped: 0, total: 0 };
      const scenariosSeeded = seedResult.seeded;
      if (seedResult.skipped > 0) {
        warnings.push(
          `${seedResult.skipped} of ${seedResult.total} paddock scenarios were skipped (invalid shape) — see api logs.`,
        );
      }

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

  // The manifest may be at archive root, or one level deep (zips of a
  // folder typically contain one top-level dir). Accept either name:
  // `agent.yaml` is preferred going forward; `template.yaml` is kept
  // for legacy zips and matches the historical default-template repo.
  private async locateManifest(rootDir: string): Promise<string> {
    const candidates = ['agent.yaml', 'template.yaml'];
    for (const name of candidates) {
      const direct = path.join(rootDir, name);
      if (await this.fileExists(direct)) return direct;
    }

    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1) {
      for (const name of candidates) {
        const nested = path.join(rootDir, dirs[0].name, name);
        if (await this.fileExists(nested)) return nested;
      }
    }
    throw new BadRequestException(
      'archive: manifest (agent.yaml or template.yaml) not found at archive root',
    );
  }

  private async uploadAgentFiles(
    templateId: string,
    agentDir: string,
    params: IInstallParamValues,
  ): Promise<number> {
    // Only `.agent/*` files are stored as template files (browseable +
    // editable in the admin UI). `.paddock/config.json` lives in the
    // Template.paddockConfig column; scenarios become DB rows.
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

    if (uploads.length > 0) {
      await this.templateFileGateway.uploadMany(templateId, uploads);
    }
    return uploads.length;
  }

  // Reads `.paddock/config.json` from the directory that holds `scenarios/`.
  // Returns null when missing or invalid JSON — install proceeds without
  // setting the column, leaving any existing value alone.
  private async readPaddockConfig(
    scenariosDir: string,
  ): Promise<Record<string, unknown> | null> {
    const paddockDir = path.dirname(scenariosDir);
    const configPath = path.join(paddockDir, 'config.json');
    if (!(await this.fileExists(configPath))) return null;
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `Failed to parse .paddock/config.json: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async collectWarnings(
    manifest: IManifest,
    existing: ITemplateData | null,
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

  private sameVersion(existing: ITemplateData, manifest: IManifest): boolean {
    return (
      existing.version !== null &&
      existing.version === manifest.metadata.version
    );
  }

  // Returns -1 if manifest < existing, 0 if equal, 1 if manifest > existing.
  // Falls back to 0 (treat as upgrade, not downgrade) when either side has
  // no recorded version — be conservative rather than blocking the operator.
  private compareSemver(
    manifest: IManifest,
    existing: ITemplateData,
  ): number {
    if (!existing.version) return 0;
    return this.semverCompare(manifest.metadata.version, existing.version);
  }

  private semverCompare(a: string, b: string): number {
    const parts = (s: string) => {
      const [main] = s.split(/[-+]/);
      return main.split('.').map((n) => parseInt(n, 10) || 0);
    };
    const A = parts(a);
    const B = parts(b);
    for (let i = 0; i < Math.max(A.length, B.length); i++) {
      const x = A[i] ?? 0;
      const y = B[i] ?? 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
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
