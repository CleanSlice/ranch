import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { SkillTool } from './skill.tool';
import type { ISkillGateway } from './domain';
import type { ISkillData } from './domain';
import type { GithubSearch } from './data/github.search';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * These tools let an agent rewrite the instructions other agents are deployed
 * with. Worth more than the happy path: that a plain agent cannot see or call
 * them, that a delete asks before it acts and says who loses the skill, and
 * that an import lands exactly where the console import would — same slug,
 * same dedup, same refusal when the slug is taken.
 */
const skill = (overrides: Partial<ISkillData> = {}): ISkillData => ({
  id: 'skill-1',
  name: 'devops',
  title: 'DevOps engineer',
  description: 'Ships things',
  body: '# DevOps\n\nDo the deploys.',
  files: [{ path: 'references/ci.md', content: 'ci notes' }],
  source: null,
  createdAt: new Date('2026-09-17T10:00:00.000Z'),
  updatedAt: new Date('2026-09-17T10:00:00.000Z'),
  ...overrides,
});

const bundle = () => ({
  title: 'PDF parsing',
  body: '# PDF\n\nParse PDFs.',
  description: 'Reads PDFs',
  files: [{ path: 'scripts/parse.py', content: 'print(1)' }],
});

const request = (roles: UserRoleTypes[]): Request =>
  ({
    user: { sub: 'agent:agent-ops', email: '', roles },
  }) as unknown as Request;

const operator = () => request([UserRoleTypes.Owner]);
const plainAgent = () => request([UserRoleTypes.Agent]);

interface Harness {
  tool: SkillTool;
  skills: jest.Mocked<
    Pick<
      ISkillGateway,
      | 'findById'
      | 'findByName'
      | 'create'
      | 'update'
      | 'delete'
      | 'findDependentAgents'
    >
  >;
  github: jest.Mocked<
    Pick<
      GithubSearch,
      'listSources' | 'search' | 'fetchBundle' | 'fetchBundleFromUrl'
    >
  >;
}

function harness(): Harness {
  const skills = {
    findById: jest.fn().mockResolvedValue(skill()),
    findByName: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation(async (data: Partial<ISkillData>) =>
        skill({ id: 'skill-new', ...data }),
      ),
    update: jest
      .fn()
      .mockImplementation(async (id: string, data: Partial<ISkillData>) =>
        skill({ id, ...data }),
      ),
    delete: jest.fn().mockResolvedValue(undefined),
    findDependentAgents: jest.fn().mockResolvedValue([]),
  } as unknown as Harness['skills'];

  const github = {
    listSources: jest
      .fn()
      .mockReturnValue([{ repo: 'anthropics/skills', label: 'Anthropic' }]),
    search: jest.fn().mockResolvedValue([
      {
        source: 'github:anthropics/skills',
        repo: 'anthropics/skills',
        path: 'skills/pdf/SKILL.md',
        name: 'pdf',
        title: 'PDF parsing',
        description: 'Reads PDFs',
        url: 'https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md',
        snippet: null,
      },
    ]),
    fetchBundle: jest.fn().mockResolvedValue(bundle()),
    fetchBundleFromUrl: jest.fn().mockResolvedValue({
      repo: 'anthropics/skills',
      skillPath: 'skills/pdf/SKILL.md',
      bundle: bundle(),
    }),
  } as unknown as Harness['github'];

  const tool = new SkillTool(
    skills as unknown as ISkillGateway,
    github as unknown as GithubSearch,
  );
  return { tool, skills, github };
}

const textOf = (result: { content: { text: string }[] }) =>
  result.content[0].text;

describe('SkillTool — who may use it', () => {
  it('hides the tools from an agent that is not a Ranch operator', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(plainAgent())).resolves.toBe(false);
  });

  it('lists them for an operator agent', async () => {
    const { tool } = harness();
    await expect(tool.isListedForRequest(operator())).resolves.toBe(true);
  });

  it('refuses a call from a plain agent even by name', async () => {
    const { tool, skills } = harness();
    await expect(
      tool.createSkill(
        { name: 'x', title: 'X', body: 'body' },
        null,
        plainAgent(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(skills.create).not.toHaveBeenCalled();
  });

  it('refuses a caller with no roles at all', async () => {
    const { tool } = harness();
    await expect(
      tool.getSkill({ id: 'skill-1' }, null, {} as Request),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SkillTool — reading', () => {
  it('returns the whole skill, body and files included', async () => {
    const { tool, skills } = harness();
    const text = textOf(
      await tool.getSkill({ id: 'skill-1' }, null, operator()),
    );
    expect(skills.findById).toHaveBeenCalledWith('skill-1');
    expect(text).toContain('"name": "devops"');
    expect(text).toContain('Do the deploys.');
    expect(text).toContain('references/ci.md');
  });

  it('points at list_skills when the id is unknown', async () => {
    const { tool, skills } = harness();
    skills.findById.mockResolvedValue(null);
    const text = textOf(await tool.getSkill({ id: 'nope' }, null, operator()));
    expect(text).toContain('not found');
    expect(text).toContain('list_skills');
  });

  it('searches the curated repos and names them next to the hits', async () => {
    const { tool, github } = harness();
    const text = textOf(
      await tool.searchSkills({ q: 'pdf parsing' }, null, operator()),
    );
    expect(github.search).toHaveBeenCalledWith('pdf parsing');
    expect(text).toContain('"sources"');
    expect(text).toContain('anthropics/skills');
    expect(text).toContain('"hits"');
    expect(text).toContain('skills/pdf/SKILL.md');
  });
});

describe('SkillTool — creating', () => {
  it('creates the skill with the fields the console form sends', async () => {
    const { tool, skills } = harness();
    const text = textOf(
      await tool.createSkill(
        { name: 'pdf', title: 'PDF parsing', body: '# PDF', description: 'x' },
        null,
        operator(),
      ),
    );
    expect(skills.create).toHaveBeenCalledWith({
      name: 'pdf',
      title: 'PDF parsing',
      body: '# PDF',
      description: 'x',
    });
    expect(text).toContain('"id": "skill-new"');
    expect(text).toContain('"name": "pdf"');
  });
});

describe('SkillTool — deleting', () => {
  it('refuses without the confirmation argument and touches nothing', async () => {
    const { tool, skills } = harness();
    const result = await tool.deleteSkill({ id: 'skill-1' }, null, operator());
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('confirm: true');
    expect(textOf(result)).toContain('«DevOps engineer»');
    expect(skills.delete).not.toHaveBeenCalled();
  });

  it('names the agents that use it in the confirmation', async () => {
    const { tool, skills } = harness();
    skills.findDependentAgents.mockResolvedValue([
      {
        id: 'agent-a',
        name: 'Ops Bot',
        status: 'running',
        templateId: 't-1',
        templateName: 'ops',
      },
    ]);
    const result = await tool.deleteSkill({ id: 'skill-1' }, null, operator());
    expect(textOf(result)).toContain('1 agent(s) use');
    expect(skills.delete).not.toHaveBeenCalled();
  });

  it('reports not found before asking for a confirmation', async () => {
    const { tool, skills } = harness();
    skills.findById.mockResolvedValue(null);
    const result = await tool.deleteSkill({ id: 'nope' }, null, operator());
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('not found');
    expect(skills.delete).not.toHaveBeenCalled();
  });

  it('deletes once confirmed and says who still runs the old copy', async () => {
    const { tool, skills } = harness();
    skills.findDependentAgents.mockResolvedValue([
      {
        id: 'agent-a',
        name: 'Ops Bot',
        status: 'running',
        templateId: 't-1',
        templateName: 'ops',
      },
    ]);
    const text = textOf(
      await tool.deleteSkill(
        { id: 'skill-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(skills.delete).toHaveBeenCalledWith('skill-1');
    expect(text).toContain('deleted');
    expect(text).toContain('ops');
    expect(text).toContain('restart_agent');
    expect(text).toContain('agent-a');
  });

  it('says so when nobody was using it', async () => {
    const { tool } = harness();
    const text = textOf(
      await tool.deleteSkill(
        { id: 'skill-1', confirm: true },
        null,
        operator(),
      ),
    );
    expect(text).toContain('No agent was using it');
  });
});

describe('SkillTool — importing', () => {
  it('imports from a URL under the slug the console would derive', async () => {
    const { tool, skills, github } = harness();
    const url = 'https://github.com/anthropics/skills/tree/main/skills/pdf';
    const text = textOf(
      await tool.importSkillFromUrl({ url }, null, operator()),
    );
    expect(github.fetchBundleFromUrl).toHaveBeenCalledWith(url);
    expect(skills.findByName).toHaveBeenCalledWith('pdf');
    expect(skills.create).toHaveBeenCalledWith({
      name: 'pdf',
      title: 'PDF parsing',
      body: '# PDF\n\nParse PDFs.',
      description: 'Reads PDFs',
      files: [{ path: 'scripts/parse.py', content: 'print(1)' }],
      source:
        'https://github.com/anthropics/skills/blob/HEAD/skills/pdf/SKILL.md',
    });
    expect(text).toContain('"name": "pdf"');
    expect(text).toContain('scripts/parse.py');
  });

  it('imports a search hit by repo and path, honouring a chosen slug', async () => {
    const { tool, skills, github } = harness();
    const text = textOf(
      await tool.importSkill(
        {
          repo: 'anthropics/skills',
          path: 'skills/pdf/SKILL.md',
          name: 'pdf-tools',
        },
        null,
        operator(),
      ),
    );
    expect(github.fetchBundle).toHaveBeenCalledWith(
      'anthropics/skills',
      'skills/pdf/SKILL.md',
    );
    expect(skills.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'pdf-tools',
        source:
          'https://github.com/anthropics/skills/blob/HEAD/skills/pdf/SKILL.md',
      }),
    );
    expect(text).toContain('"name": "pdf-tools"');
  });

  it('refuses to import over an existing slug and names both ways forward', async () => {
    const { tool, skills } = harness();
    skills.findByName.mockResolvedValue(
      skill({ id: 'skill-old', name: 'pdf', title: 'Old PDF' }),
    );
    const result = await tool.importSkill(
      { repo: 'anthropics/skills', path: 'skills/pdf/SKILL.md' },
      null,
      operator(),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('already exists');
    expect(textOf(result)).toContain('skill-old');
    expect(textOf(result)).toContain('overwrite: true');
    expect(skills.create).not.toHaveBeenCalled();
    expect(skills.update).not.toHaveBeenCalled();
  });

  it('replaces the existing skill in full when overwrite is true', async () => {
    const { tool, skills } = harness();
    skills.findByName.mockResolvedValue(
      skill({ id: 'skill-old', name: 'pdf' }),
    );
    const text = textOf(
      await tool.importSkillFromUrl(
        {
          url: 'https://github.com/anthropics/skills/tree/main/skills/pdf',
          overwrite: true,
        },
        null,
        operator(),
      ),
    );
    expect(skills.create).not.toHaveBeenCalled();
    expect(skills.update).toHaveBeenCalledWith('skill-old', {
      title: 'PDF parsing',
      body: '# PDF\n\nParse PDFs.',
      description: 'Reads PDFs',
      files: [{ path: 'scripts/parse.py', content: 'print(1)' }],
      source:
        'https://github.com/anthropics/skills/blob/HEAD/skills/pdf/SKILL.md',
    });
    expect(text).toContain('"id": "skill-old"');
  });

  it('lets a GitHub failure escape, so the MCP layer reports it as an error', async () => {
    const { tool, github, skills } = harness();
    github.fetchBundleFromUrl.mockRejectedValue(
      new Error('Not a recognised GitHub URL: https://example.com'),
    );
    await expect(
      tool.importSkillFromUrl({ url: 'https://example.com' }, null, operator()),
    ).rejects.toThrow('Not a recognised GitHub URL');
    expect(skills.create).not.toHaveBeenCalled();
  });
});
