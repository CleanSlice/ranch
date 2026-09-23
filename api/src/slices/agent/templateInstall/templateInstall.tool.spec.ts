import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { TemplateInstallTool } from './templateInstall.tool';
import type { TemplateInstallService } from './domain/templateInstall.service';
import type { ITemplateGateway, ITemplateData } from '#/agent/template/domain';
import type { IInstallPreview, IInstallResult } from './domain';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Installing a template writes to the database and S3 on the strength of a
 * URL, so the two things that matter most here are that a plain agent can
 * neither see nor call these tools, and that a secret handed to an install
 * never comes back out through the result — not from the install, and not
 * from a manifest that spelled a credential out instead of `$secret:NAME`.
 */
const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

const GIT_URL = 'https://github.com/CleanSlice/agent-templates.git';
const SECRET = 'sk-live-do-not-leak-me';

const preview = (): IInstallPreview =>
  ({
    manifest: {
      apiVersion: 'ranch/v1',
      kind: 'AgentTemplate',
      metadata: { id: 'support-bot', name: 'Support Bot', version: '1.2.0' },
      mcp: [{ id: 'mcp-ranch', authValue: SECRET }],
      secrets: [{ name: 'MCP_RANCH_AUTH', required: true }],
    },
    willCreate: true,
    willUpgrade: false,
    declared: {
      skills: [{ id: 'returns', resolved: true }],
      mcp: [{ id: 'mcp-ranch', resolved: false }],
      secrets: [{ name: 'MCP_RANCH_AUTH', required: true }],
    },
    files: { agentFiles: 4, scenarioFiles: 2 },
    warnings: ['mcp "mcp-ranch" is not registered on this Ranch'],
  }) as unknown as IInstallPreview;

const installed = (): IInstallResult => ({
  templateId: 'support-bot',
  templateName: 'Support Bot',
  filesUploaded: 4,
  scenariosSeeded: 2,
  mcpAttached: ['mcp-ranch'],
  skillsAttached: ['returns'],
  unresolvedMcp: [],
  unresolvedSkills: [],
  warnings: [],
});

const template = (): ITemplateData =>
  ({
    id: 'support-bot',
    name: 'Support Bot',
    version: '1.2.0',
    skillIds: [],
    mcpServerIds: [],
  }) as unknown as ITemplateData;

interface Harness {
  tool: TemplateInstallTool;
  installs: { previewFromGit: jest.Mock; installFromGit: jest.Mock };
  templates: { findById: jest.Mock };
}

function harness(): Harness {
  const installs = {
    previewFromGit: jest.fn().mockResolvedValue(preview()),
    installFromGit: jest.fn().mockResolvedValue(installed()),
  };
  const templates = { findById: jest.fn().mockResolvedValue(template()) };
  const tool = new TemplateInstallTool(
    installs as unknown as TemplateInstallService,
    templates as unknown as ITemplateGateway,
  );
  return { tool, installs, templates };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('TemplateInstallTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses an install from a plain agent even by name', async () => {
    const { tool, installs } = harness();
    await expect(
      tool.installTemplateFromGit({ gitUrl: GIT_URL }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(installs.installFromGit).not.toHaveBeenCalled();
  });

  it('refuses a preview and an export from a plain agent too', async () => {
    const { tool, installs, templates } = harness();
    await expect(
      tool.previewTemplateInstallFromGit(
        { gitUrl: GIT_URL },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      tool.exportTemplate({ templateId: 'support-bot' }, null, plainAgent()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(installs.previewFromGit).not.toHaveBeenCalled();
    expect(templates.findById).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.exportTemplate({ templateId: 'support-bot' }, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TemplateInstallTool — preview_template_install_from_git', () => {
  it('passes url, ref and params to the service and returns what the controller would', async () => {
    const { tool, installs } = harness();
    const text = textOf(
      await tool.previewTemplateInstallFromGit(
        { gitUrl: GIT_URL, gitRef: 'v1.2.0', params: { language: 'ru' } },
        null,
        operator(),
      ),
    );
    expect(installs.previewFromGit).toHaveBeenCalledWith(GIT_URL, 'v1.2.0', {
      language: 'ru',
    });
    expect(text).toContain('"willCreate": true');
    expect(text).toContain('"agentFiles": 4');
    expect(text).toContain('MCP_RANCH_AUTH');
    expect(text).toContain('not registered on this Ranch');
  });

  it('defaults ref to the remote default branch and params to none', async () => {
    const { tool, installs } = harness();
    await tool.previewTemplateInstallFromGit(
      { gitUrl: GIT_URL },
      null,
      operator(),
    );
    expect(installs.previewFromGit).toHaveBeenCalledWith(
      GIT_URL,
      undefined,
      {},
    );
  });

  it('keeps declared secret names but never a credential spelled out in the manifest', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.previewTemplateInstallFromGit(
        { gitUrl: GIT_URL },
        null,
        operator(),
      ),
    );
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('authValue');
    expect(text).toContain('"name": "MCP_RANCH_AUTH"');
  });

  it('lets the service refuse a bad URL, as the console would see it', async () => {
    const { tool, installs } = harness();
    installs.previewFromGit.mockRejectedValue(
      new BadRequestException('gitUrl contains forbidden characters'),
    );
    await expect(
      tool.previewTemplateInstallFromGit(
        { gitUrl: 'https://x.test/a;rm -rf' },
        null,
        operator(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TemplateInstallTool — install_template_from_git', () => {
  it('installs with params and secrets and reports what was attached', async () => {
    const { tool, installs } = harness();
    const text = textOf(
      await tool.installTemplateFromGit(
        {
          gitUrl: GIT_URL,
          gitRef: 'main',
          params: { language: 'ru' },
          secrets: { MCP_RANCH_AUTH: SECRET },
        },
        null,
        operator(),
      ),
    );
    expect(installs.installFromGit).toHaveBeenCalledWith(
      GIT_URL,
      'main',
      { language: 'ru' },
      { MCP_RANCH_AUTH: SECRET },
    );
    expect(text).toContain('"templateId": "support-bot"');
    expect(text).toContain('"filesUploaded": 4');
    expect(text).toContain('mcp-ranch');
  });

  it('never echoes a supplied secret', async () => {
    const { tool, installs } = harness();
    // Even if a future result grew a field carrying it back.
    installs.installFromGit.mockResolvedValue({
      ...installed(),
      authValue: SECRET,
    });
    const text = textOf(
      await tool.installTemplateFromGit(
        { gitUrl: GIT_URL, secrets: { MCP_RANCH_AUTH: SECRET } },
        null,
        operator(),
      ),
    );
    expect(text).not.toContain(SECRET);
  });

  it('defaults params and secrets to empty objects like the controller', async () => {
    const { tool, installs } = harness();
    await tool.installTemplateFromGit({ gitUrl: GIT_URL }, null, operator());
    expect(installs.installFromGit).toHaveBeenCalledWith(
      GIT_URL,
      undefined,
      {},
      {},
    );
  });
});

describe('TemplateInstallTool — export_template', () => {
  it('returns the console download path for a template that exists', async () => {
    const { tool, templates } = harness();
    const text = textOf(
      await tool.exportTemplate(
        { templateId: 'support-bot' },
        null,
        operator(),
      ),
    );
    expect(templates.findById).toHaveBeenCalledWith('support-bot');
    expect(text).toContain('"downloadPath": "/templates/support-bot/download"');
    expect(text).toContain('"name": "Support Bot"');
    expect(text).toContain('needs your login');
  });

  it('names the next move when the template does not exist', async () => {
    const { tool, templates } = harness();
    templates.findById.mockResolvedValue(null);
    const text = textOf(
      await tool.exportTemplate({ templateId: 'nope' }, null, operator()),
    );
    expect(text).toContain('Template nope not found');
    expect(text).toContain('list_templates');
    expect(text).not.toContain('downloadPath');
  });
});
