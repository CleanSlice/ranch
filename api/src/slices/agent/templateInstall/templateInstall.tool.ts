import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  ok,
  requireOperator,
  stripSecrets,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { TemplateInstallService } from './domain/templateInstall.service';
import { IInstallParamValues, IInstallSecretValues } from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** The body of `POST templates/install/from-git` and its preview, as zod. */
const gitInstallParameters = z.object({
  gitUrl: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      'Git URL of the template repository — https://, http://, git@host:... ' +
        'or ssh://host/.../repo.git',
    ),
  gitRef: z
    .string()
    .max(100)
    .optional()
    .describe('Branch, tag or short SHA. Omit for the remote default branch.'),
  params: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      'Operator-supplied params the manifest declares, e.g. {"language":"ru"}. ' +
        'Validated against the manifest.',
    ),
});

/**
 * Installing and exporting templates from the chat (CLEAN-109), the way the
 * console's Install page and download button do it.
 *
 * Every install goes through `TemplateInstallService`, the same service the
 * controller calls: URL vetting, the clone timeout, manifest validation and
 * secret resolution live there, and nothing of it is re-implemented here.
 *
 * Two console capabilities stay out on purpose. A zip on a person's machine
 * cannot travel through a tool call, so zip install remains console-only; a
 * git URL covers the same source without a browser. And a tool cannot hand
 * back bytes, so `export_template` does the existence check
 * `TemplateExportService.exportZip` starts with and returns the download
 * path the console serves rather than the archive itself.
 *
 * Operator-only: installing a template writes to the database and S3, and a
 * plain agent must never be able to bring a new agent template into the
 * Ranch, least of all one a prompt injection pointed it at.
 */
@Injectable()
export class TemplateInstallTool implements IConditionallyListedTool {
  constructor(
    private readonly installs: TemplateInstallService,
    private readonly templates: ITemplateGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'preview_template_install_from_git',
    topic: ToolTopics.Templates,
    title: 'Preview a git template',
    template:
      'What would installing the template from «git url» at «ref» bring?',
    description:
      'Clone a template repository and report what installing it would do, ' +
      'without writing anything: the parsed manifest, whether it would ' +
      'create a new template or upgrade an existing one (and which), the ' +
      'skills and MCP servers it declares and whether each resolves on this ' +
      'Ranch, the secrets it needs, file counts and warnings. Call this ' +
      'before install_template_from_git and show the person the outcome; ' +
      'unresolved skills or MCP servers and required secrets are what they ' +
      'need to decide on.',
    parameters: gitInstallParameters,
  })
  async previewTemplateInstallFromGit(
    args: {
      gitUrl: string;
      gitRef?: string;
      params?: IInstallParamValues;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const result = await this.installs.previewFromGit(
      args.gitUrl,
      args.gitRef,
      args.params ?? {},
    );
    // Same shape the controller returns. A manifest may carry a literal
    // credential where the author should have written `$secret:NAME`;
    // the declared secret names survive, the values do not (FR-004).
    return ok(
      stripSecrets({
        manifest: result.manifest as unknown as Record<string, unknown>,
        willCreate: result.willCreate,
        willUpgrade: result.willUpgrade,
        existingTemplateId: result.existingTemplateId,
        declared: result.declared,
        files: result.files,
        warnings: result.warnings,
      }),
    );
  }

  @Tool({
    name: 'install_template_from_git',
    topic: ToolTopics.Templates,
    title: 'Install a template from git',
    template: 'Install the template from «git url» at «ref»',
    description:
      'Clone a template repository and install it on this Ranch: creates ' +
      'the template or upgrades the one with the same manifest id, uploads ' +
      'its files, seeds its Paddock scenarios and attaches the skills and ' +
      'MCP servers it declares. Pass the params and secrets the preview ' +
      'listed; secrets are used once to resolve $secret:NAME references and ' +
      'never echoed. Returns the template id and name plus what was ' +
      'attached, what stayed unresolved and any warnings — the template is ' +
      'ready for create_agent afterwards. Run ' +
      'preview_template_install_from_git first. For a zip on your computer ' +
      "use the console's Install page; a tool call cannot carry a file.",
    parameters: gitInstallParameters.extend({
      secrets: z
        .record(z.string())
        .optional()
        .describe(
          'Operator-supplied secrets by name, e.g. {"MCP_RANCH_AUTH":"..."} ' +
            '— resolves $secret:NAME references in the manifest. Never ' +
            'echoed back.',
        ),
    }),
  })
  async installTemplateFromGit(
    args: {
      gitUrl: string;
      gitRef?: string;
      params?: IInstallParamValues;
      secrets?: IInstallSecretValues;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const result = await this.installs.installFromGit(
      args.gitUrl,
      args.gitRef,
      args.params ?? {},
      args.secrets ?? {},
    );
    // The install result names ids and counts only, never the secrets it
    // consumed; stripping is belt and braces should that ever change.
    return ok(stripSecrets(result));
  }

  @Tool({
    name: 'export_template',
    topic: ToolTopics.Templates,
    title: 'Export a template',
    template: 'Export the template «name»',
    description:
      'Export a template as an installable zip: agent.yaml, .agent/* files, ' +
      'bundled skills, .paddock/config.json and scenarios. MCP credentials ' +
      'are never included. A tool call cannot carry the archive, so this ' +
      'confirms the template exists and returns the console path that ' +
      'serves the download; give that path to the person. Takes the ' +
      'template id — list_templates has it when you only know the name.',
    parameters: z.object({
      templateId: z.string().describe('Template id (list_templates has them)'),
    }),
  })
  async exportTemplate(
    args: { templateId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    // The export service looks the template up the same way before it
    // builds the archive; checking here spares building a zip nobody
    // receives.
    const template = await this.templates.findById(args.templateId);
    if (!template) {
      return ok({
        error: `Template ${args.templateId} not found — call list_templates to find the id`,
      });
    }
    return ok({
      templateId: template.id,
      name: template.name,
      version: template.version,
      downloadPath: `/templates/${template.id}/download`,
      note: 'Open this path in the console (it needs your login) to download the zip.',
    });
  }
}
