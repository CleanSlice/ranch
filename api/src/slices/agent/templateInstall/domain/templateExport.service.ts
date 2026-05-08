import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import * as archiver from 'archiver';
import { stringify as yamlStringify } from 'yaml';
import { ITemplateGateway, ITemplateData } from '#/agent/template/domain';
import { ITemplateFileGateway } from '#/agent/templateFile/domain';
import {
  IPaddockScenarioGateway,
  IPaddockScenarioData,
} from '#/paddock/scenario/domain';
import { ISkillGateway } from '#/skill/domain/skill.gateway';
import { ISkillData } from '#/skill/domain/skill.types';
import { IMcpServerGateway } from '#/mcpServer/domain/mcpServer.gateway';
import { IMcpServerData } from '#/mcpServer/domain/mcpServer.types';

export interface ITemplateExportResult {
  filename: string;
  buffer: Buffer;
}

// Canonical field order for the emitted agent.yaml. Reading order:
// apiVersion / kind on top, then identity, requirements, structure,
// content lists, then per-feature config sections.
const TOP_LEVEL_ORDER = [
  'apiVersion',
  'kind',
  'metadata',
  'requirements',
  'files',
  'skills',
  'mcp',
  'params',
  'secrets',
  'paddock',
  'permissions',
  'compliance',
  'hooks',
];

const METADATA_ORDER = [
  'id',
  'name',
  'version',
  'description',
  'author',
  'homepage',
  'license',
  'tags',
  'i18n',
];

const REQUIREMENTS_ORDER = ['ranchRuntime', 'ranch', 'services', 'env'];
const FILES_ORDER = ['agent', 'paddock'];
const PADDOCK_ORDER = [
  'seedScenarios',
  'runOnInstall',
  'passThreshold',
  'requiredFor',
];
const PERMISSIONS_ORDER = ['network', 'adminTools'];

function reorder(
  obj: Record<string, unknown>,
  order: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
}

function reorderManifest(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  const reordered = reorder(manifest, TOP_LEVEL_ORDER);
  if (reordered.metadata && typeof reordered.metadata === 'object') {
    reordered.metadata = reorder(
      reordered.metadata as Record<string, unknown>,
      METADATA_ORDER,
    );
  }
  if (reordered.requirements && typeof reordered.requirements === 'object') {
    reordered.requirements = reorder(
      reordered.requirements as Record<string, unknown>,
      REQUIREMENTS_ORDER,
    );
  }
  if (reordered.files && typeof reordered.files === 'object') {
    reordered.files = reorder(
      reordered.files as Record<string, unknown>,
      FILES_ORDER,
    );
  }
  if (reordered.paddock && typeof reordered.paddock === 'object') {
    reordered.paddock = reorder(
      reordered.paddock as Record<string, unknown>,
      PADDOCK_ORDER,
    );
  }
  if (reordered.permissions && typeof reordered.permissions === 'object') {
    reordered.permissions = reorder(
      reordered.permissions as Record<string, unknown>,
      PERMISSIONS_ORDER,
    );
  }
  return reordered;
}

@Injectable()
export class TemplateExportService {
  private readonly logger = new Logger(TemplateExportService.name);

  constructor(
    private readonly templateGateway: ITemplateGateway,
    private readonly templateFileGateway: ITemplateFileGateway,
    private readonly scenarioGateway: IPaddockScenarioGateway,
    private readonly skillGateway: ISkillGateway,
    private readonly mcpServerGateway: IMcpServerGateway,
  ) {}

  async exportZip(id: string): Promise<ITemplateExportResult> {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException(`Template ${id} not found`);

    const [files, scenarios] = await Promise.all([
      this.templateFileGateway.list(id),
      this.scenarioGateway.findAll({ templateId: id }),
    ]);

    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
      archive.on('warning', (w) => this.logger.warn(`archiver: ${w.message}`));
    });

    // Layout convention (works the same for templates installed via the
    // wizard and for legacy rancher-seeded templates):
    //
    //   agent.yaml                 ← manifest at zip root
    //   .agent/                    ← every agent-runtime file
    //     agent.config.json, SOUL.md, …, skills/<name>/SKILL.md, …
    //   .paddock/                  ← eval data
    //     config.json
    //     scenarios/<category>/<slug>.yml
    //
    // Bundled skills live under `.agent/skills/<name>/` so the agent
    // sees them on its filesystem the same way at runtime.

    const skills = await this.loadSkills(template.skillIds);
    const skillTargetPrefixes = skills.map(
      (s) => `.agent/skills/${s.name}/`,
    );

    // 1. .agent/* files from S3. Strip any leading `.agent/` (legacy
    // rancher seed didn't prefix), then re-prefix uniformly. Skip anything
    // that would collide with a DB-attached skill bundle — DB content wins.
    for (const node of files) {
      const rel = node.path.replace(/^\.agent\//, '');
      const target = `.agent/${rel}`;
      if (skillTargetPrefixes.some((p) => target.startsWith(p))) {
        this.logger.warn(
          `Skipping S3 file ${node.path} — overridden by DB-attached skill bundle`,
        );
        continue;
      }
      try {
        const content = await this.templateFileGateway.read(id, node.path);
        archive.append(content.content, { name: target });
      } catch (err) {
        this.logger.warn(
          `Skipping file ${node.path}: ${(err as Error).message}`,
        );
      }
    }

    // 2. DB-attached skills → .agent/skills/<name>/...
    for (const skill of skills) {
      archive.append(skill.body, {
        name: `.agent/skills/${skill.name}/SKILL.md`,
      });
      for (const file of skill.files ?? []) {
        archive.append(file.content, {
          name: `.agent/skills/${skill.name}/${file.path}`,
        });
      }
    }

    // 3. agent.yaml at root. Prefer manifestJson; fall back to
    // synthesized. Rewrite skills[] and mcp[] from current DB state so
    // attachments added or removed via the admin UI after install are
    // reflected in the export (manifestJson is a frozen install-time
    // snapshot, not authoritative for current attachments). Then
    // normalise field order so emitted YAML reads top-to-bottom
    // independent of how Postgres serialised the JSON column.
    const baseManifest =
      template.manifestJson ?? this.synthesizeManifest(template);
    const mcps = await this.loadMcps(template.mcpServerIds);
    const manifest = reorderManifest(
      this.applyAttachedMcps(
        this.applyBundledSkills(baseManifest, skills),
        mcps,
      ),
    );
    archive.append(yamlStringify(manifest), { name: 'agent.yaml' });

    // 4. .paddock/config.json — only if non-empty.
    if (
      template.paddockConfig &&
      Object.keys(template.paddockConfig).length > 0
    ) {
      archive.append(JSON.stringify(template.paddockConfig, null, 2) + '\n', {
        name: '.paddock/config.json',
      });
    }

    // 5. .paddock/scenarios/<category>/<slug>.yml — round-trip from DB.
    for (const s of scenarios) {
      const yamlSrc = yamlStringify(this.scenarioToYaml(s));
      archive.append(yamlSrc, {
        name: `.paddock/scenarios/${s.category}/${this.slug(s.name)}.yml`,
      });
    }

    await archive.finalize();
    await done;

    const filename = template.version
      ? `${template.id}-v${template.version}.zip`
      : `${template.id}.zip`;
    return { filename, buffer: Buffer.concat(chunks) };
  }

  // For legacy templates without a manifestJson: produce a minimal v1
  // manifest from the columns we do have. Round-trip is lossy (UI hints,
  // params, secrets are not recoverable) but install will still accept it.
  // Skills are filled in by `applyBundledSkills` after this returns.
  private synthesizeManifest(template: ITemplateData): Record<string, unknown> {
    return {
      apiVersion: 'ranch/v1',
      kind: 'AgentTemplate',
      metadata: {
        id: template.id,
        name: template.name,
        version: template.version ?? '0.0.0',
        description: template.description,
      },
      files: { agent: './.agent', paddock: './.paddock' },
      skills: [],
      mcp: template.mcpServerIds.map((mcpId) => ({ id: mcpId })),
      paddock: { seedScenarios: true },
    };
  }

  private async loadSkills(skillIds: string[]): Promise<ISkillData[]> {
    const out: ISkillData[] = [];
    for (const id of skillIds) {
      try {
        const skill = await this.skillGateway.findById(id);
        if (skill) out.push(skill);
        else this.logger.warn(`Skill ${id} not found — skipped`);
      } catch (err) {
        this.logger.warn(
          `Failed to load skill ${id}: ${(err as Error).message}`,
        );
      }
    }
    return out;
  }

  // Replace manifest.skills with bundle pointers. Each entry keeps the
  // human-readable skill `name` as id (not the DB uuid) and a `source`
  // path so re-installs can register the bundled skill from disk.
  // When the skill was imported from an upstream URL (Skill.source in
  // DB, e.g. github.com/owner/repo/SKILL.md), expose that as `github`
  // so the manifest carries provenance for traceability.
  private applyBundledSkills(
    manifest: Record<string, unknown>,
    skills: ISkillData[],
  ): Record<string, unknown> {
    return {
      ...manifest,
      skills: skills.map((s) => {
        const entry: Record<string, unknown> = {
          id: s.name,
          source: `./.agent/skills/${s.name}`,
        };
        if (s.source) entry.github = s.source;
        return entry;
      }),
    };
  }

  private async loadMcps(ids: string[]): Promise<IMcpServerData[]> {
    const out: IMcpServerData[] = [];
    for (const id of ids) {
      try {
        const m = await this.mcpServerGateway.findById(id);
        if (m) out.push(m);
        else this.logger.warn(`McpServer ${id} not found — skipped`);
      } catch (err) {
        this.logger.warn(
          `Failed to load mcp ${id}: ${(err as Error).message}`,
        );
      }
    }
    return out;
  }

  // Rewrite manifest.mcp from current Template.mcpServerIds, expanding
  // each entry with the McpServer's connection details so a re-installer
  // (or human reader) sees how to wire up the same MCP elsewhere.
  // Preserves any `config` block from the frozen manifestJson when the
  // id still matches; drops detached entries.
  // SECURITY: authValue is intentionally never exported — re-install
  // must supply credentials separately.
  private applyAttachedMcps(
    manifest: Record<string, unknown>,
    mcps: IMcpServerData[],
  ): Record<string, unknown> {
    const previous = (manifest.mcp ?? []) as Array<Record<string, unknown>>;
    const previousById = new Map<string, Record<string, unknown>>();
    for (const entry of previous) {
      if (typeof entry.id === 'string') previousById.set(entry.id, entry);
    }

    const declaredSecrets: Record<string, unknown>[] = [];

    const mcpEntries = mcps.map((m) => {
      const entry: Record<string, unknown> = {
        id: m.id,
        name: m.name,
      };
      if (m.description) entry.description = m.description;
      if (m.url) entry.url = m.url;
      if (m.transport) entry.transport = m.transport;
      if (m.authType && m.authType !== 'none') {
        entry.authType = m.authType;
        // Placeholder — the real value is provided at install time
        // via the secret store, not bundled into the manifest.
        // Strip the conventional `mcp-` id prefix so we don't end up
        // with redundant `MCP_MCP_<X>_AUTH`.
        const slug = m.id
          .replace(/^mcp[_-]/i, '')
          .toUpperCase()
          .replace(/-/g, '_');
        const secretName = `MCP_${slug}_AUTH`;
        entry.authValue = `$secret:${secretName}`;
        declaredSecrets.push({
          name: secretName,
          required: true,
          label: `${m.name} auth`,
          hint: `Auth credential for the ${m.name} MCP server (${m.authType}). Used by the install layer to populate McpServer.authValue when re-creating this MCP on a different ranch.`,
          groupId: 'mcp',
          groupLabel: 'MCP authentication',
        });
      }
      if (m.builtIn) entry.builtIn = true;
      // Re-attach any config block authored in the original manifest.
      const prev = previousById.get(m.id);
      if (prev && prev.config && typeof prev.config === 'object') {
        entry.config = prev.config;
      }
      return entry;
    });

    return {
      ...manifest,
      mcp: mcpEntries,
      secrets: this.mergeSecrets(manifest.secrets, declaredSecrets),
    };
  }

  // Merge auto-generated MCP-auth secret declarations with whatever the
  // original manifest declared. Manifest-authored entries win on name
  // collisions (operator authoring is more authoritative than the
  // export layer's heuristic).
  private mergeSecrets(
    existing: unknown,
    additions: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    const existingArr = Array.isArray(existing)
      ? (existing as Record<string, unknown>[])
      : [];
    const out: Record<string, unknown>[] = [...existingArr];
    const known = new Set(
      existingArr
        .map((s) => (typeof s.name === 'string' ? s.name : null))
        .filter((n): n is string => n !== null),
    );
    for (const a of additions) {
      const name = a.name as string;
      if (!known.has(name)) {
        out.push(a);
        known.add(name);
      }
    }
    return out;
  }

  private scenarioToYaml(s: IPaddockScenarioData): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: s.id,
      category: s.category,
      difficulty: s.difficulty,
      name: s.name,
      description: s.description,
      expectedBehavior: s.expectedBehavior,
      messages: s.messages,
      successCriteria: s.successCriteria,
    };
    if (s.setup) out.setup = s.setup;
    return out;
  }

  private slug(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'scenario'
    );
  }
}
