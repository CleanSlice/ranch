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

export interface ITemplateExportResult {
  filename: string;
  buffer: Buffer;
}

@Injectable()
export class TemplateExportService {
  private readonly logger = new Logger(TemplateExportService.name);

  constructor(
    private readonly templateGateway: ITemplateGateway,
    private readonly templateFileGateway: ITemplateFileGateway,
    private readonly scenarioGateway: IPaddockScenarioGateway,
    private readonly skillGateway: ISkillGateway,
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

    // 1. Resolve attached skills, bundle their content into skills/<name>/,
    // and rewrite manifest.skills to point at the bundles (preserves the
    // SKILL.md frontmatter + sibling files so re-installs are self-contained).
    const skills = await this.loadSkills(template.skillIds);
    for (const skill of skills) {
      archive.append(skill.body, {
        name: `skills/${skill.name}/SKILL.md`,
      });
      for (const file of skill.files ?? []) {
        archive.append(file.content, {
          name: `skills/${skill.name}/${file.path}`,
        });
      }
    }

    // 2. template.yaml — prefer manifestJson; fall back to synthesized.
    // In both cases, rewrite skills[] so each entry points at the bundle.
    const baseManifest =
      template.manifestJson ?? this.synthesizeManifest(template);
    const manifest = this.applyBundledSkills(baseManifest, skills);
    archive.append(yamlStringify(manifest), { name: 'template.yaml' });

    // 2. README.md (only if we know it; manifestJson doesn't contain it)
    // Skip — README is repo-level, not template-content.

    // 3. .agent/* files — read each from S3 and append.
    for (const node of files) {
      try {
        const content = await this.templateFileGateway.read(id, node.path);
        archive.append(content.content, { name: content.path });
      } catch (err) {
        this.logger.warn(
          `Skipping file ${node.path}: ${(err as Error).message}`,
        );
      }
    }

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
  private applyBundledSkills(
    manifest: Record<string, unknown>,
    skills: ISkillData[],
  ): Record<string, unknown> {
    return {
      ...manifest,
      skills: skills.map((s) => ({
        id: s.name,
        source: `./skills/${s.name}`,
      })),
    };
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
