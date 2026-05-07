import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import * as archiver from 'archiver';
import { stringify as yamlStringify } from 'yaml';
import { ITemplateGateway, ITemplateData } from '#/agent/template/domain';
import { ITemplateFileGateway } from '#/agent/templateFile/domain';
import {
  IPaddockScenarioGateway,
  IPaddockScenarioData,
} from '#/paddock/scenario/domain';

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

    // 1. template.yaml — prefer manifestJson; fall back to synthesized.
    const manifest = template.manifestJson ?? this.synthesizeManifest(template);
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
      skills: template.skillIds.map((skillId) => ({ id: skillId })),
      mcp: template.mcpServerIds.map((mcpId) => ({ id: mcpId })),
      paddock: { seedScenarios: true },
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
