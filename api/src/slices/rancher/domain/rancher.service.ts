import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { promises as fs } from 'fs';
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
  RANCHER_TEMPLATE_ID,
  RANCHER_TEMPLATE_NAME,
  RANCHER_TEMPLATE_DEFAULTS,
  IRancherStatus,
} from './rancher.types';

@Injectable()
export class RancherService {
  private readonly logger = new Logger(RancherService.name);

  constructor(
    private templateGateway: ITemplateGateway,
    private templateFileGateway: ITemplateFileGateway,
    private agentGateway: IAgentGateway,
    private llmGateway: ILlmGateway,
    private settingGateway: ISettingGateway,
    private mcpServerGateway: IMcpServerGateway,
  ) {}

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
    return withMcps;
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
}
