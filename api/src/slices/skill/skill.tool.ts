import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import { ISkillGateway } from './domain';
import type { ISkillFile } from './domain';
import { GithubSearch } from './data/github.search';
import { deriveSlug } from './skill.controller';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** Same rule as the create/import DTOs: a skill name is a slug. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_MESSAGE =
  'name must be a slug: lowercase letters, digits and dashes (e.g. "devops")';

const NOT_FOUND = (id: string) =>
  ok({ error: `Skill ${id} not found — call list_skills to find the id` });

/**
 * The skill capabilities the console has and `rancher.tool.ts` did not
 * (CLEAN-109): read one, create one, delete one, and the two GitHub import
 * paths with the search that feeds them. `list_skills`, `update_skill`,
 * `list_skill_agents` and `redeploy_skill_agents` stay in `rancher.tool.ts`.
 *
 * Every call goes through `ISkillGateway` and `GithubSearch`, the two things
 * `SkillController` injects, in the order the controller calls them. The
 * import dedup (same slug → refuse unless `overwrite`) is the controller's
 * rule, kept here verbatim so a chat import cannot silently replace a skill
 * the console would have asked about.
 *
 * Operator-only: a plain agent must not be able to rewrite the instructions
 * other agents are deployed with.
 */
@Injectable()
export class SkillTool implements IConditionallyListedTool {
  private readonly logger = new Logger(SkillTool.name);

  constructor(
    private readonly skills: ISkillGateway,
    private readonly github: GithubSearch,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  // ─── Reading ─────────────────────────────────────────────────────────

  @Tool({
    name: 'get_skill',
    topic: ToolTopics.Skills,
    title: 'Show a skill',
    template: 'Show the skill «name»',
    description:
      'Read one skill in full: its slug, title, description, the SKILL.md ' +
      'body, its helper files and where it was imported from. Takes the ' +
      'skill id — resolve a name with list_skills first. Read this before ' +
      'update_skill so you change only what the person asked for.',
    parameters: z.object({
      id: z.string().describe('Skill id (list_skills has them)'),
    }),
  })
  async getSkill(
    { id }: { id: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const skill = await this.skills.findById(id);
    if (!skill) return NOT_FOUND(id);
    return ok(skill);
  }

  @Tool({
    name: 'search_skills',
    topic: ToolTopics.Skills,
    title: 'Search public skills',
    template: 'Find public skills about «topic»',
    description:
      'Search the curated public GitHub repos for skills matching a topic. ' +
      'Returns the repos searched (`sources`) and the matching skills ' +
      '(`hits`), each with the repo and path import_skill needs, a proposed ' +
      'slug, title and description, and a link to read it on GitHub. Needs ' +
      'a GitHub token in Settings (integrations/github_pat); the call ' +
      'reports it when one is missing. Show the person the hits and import ' +
      'the one they pick with import_skill.',
    parameters: z.object({
      q: z
        .string()
        .min(2)
        .describe('What the skill should be about, e.g. "pdf parsing"'),
    }),
  })
  async searchSkills(
    { q }: { q: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    // Sources first so the model can tell the person where it looked even
    // when nothing matched — the controller exposes them as GET skills/sources.
    const sources = this.github.listSources();
    const hits = await this.github.search(q);
    return ok({ sources, hits });
  }

  // ─── Changing ────────────────────────────────────────────────────────

  @Tool({
    name: 'create_skill',
    topic: ToolTopics.Skills,
    title: 'Create a skill',
    template: 'Create a skill «title» that «what it does»',
    description:
      'Create a skill from scratch: a slug, a title and the SKILL.md markdown ' +
      'body that agents will read. Returns the created skill with its id. A ' +
      'new skill does nothing on its own — attach it to a template with ' +
      'set_template_skills, then redeploy the agents of that template. To ' +
      'bring in an existing skill from GitHub use import_skill_from_url or ' +
      'search_skills + import_skill instead.',
    parameters: z.object({
      name: z
        .string()
        .regex(SLUG, SLUG_MESSAGE)
        .describe('Unique slug — lowercase letters, digits, dashes'),
      title: z.string().describe('Human title, e.g. "DevOps engineer"'),
      body: z.string().describe('Markdown body of the skill (the SKILL.md)'),
      description: z
        .string()
        .optional()
        .describe('One line on when an agent should reach for it'),
    }),
  })
  async createSkill(
    args: { name: string; title: string; body: string; description?: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const created = await this.skills.create(args);
    this.logger.log(
      `Skill created through MCP: ${created.name} (${created.id})`,
    );
    return ok(created);
  }

  @Tool({
    name: 'delete_skill',
    topic: ToolTopics.Skills,
    title: 'Delete a skill',
    template: 'Delete the skill «name»',
    destructive: true,
    description:
      'Delete a skill and detach it from every template that includes it. ' +
      'Not reversible — the body and helper files are gone; re-import from ' +
      'the source URL if it had one. Agents already running keep the copy ' +
      'baked into their pod until they restart. Check list_skill_agents ' +
      'first and tell the person which agents will lose it. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      id: z.string().describe('Skill id (list_skills has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteSkill(
    args: { id: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { id } = args;
    const skill = await this.skills.findById(id);
    if (!skill) return NOT_FOUND(id);

    // The gateway does not refuse a skill in use (the template link is an
    // implicit many-to-many, dropped with the row), so the tool names the
    // fallout in the confirmation instead of finding out afterwards.
    const dependents = await this.skills.findDependentAgents(id);
    const inUse =
      dependents.length > 0
        ? `, which ${dependents.length} agent(s) use through their templates`
        : '';
    const refusal = confirmed(
      args,
      `delete the skill «${skill.title}»${inUse}`,
    );
    if (refusal) return refusal;

    await this.skills.delete(id);
    this.logger.log(`Skill deleted through MCP: ${skill.name} (${id})`);

    const templates = [...new Set(dependents.map((d) => d.templateName))];
    return ok(
      `Skill «${skill.title}» (${skill.name}) deleted.` +
        (dependents.length === 0
          ? ' No agent was using it.'
          : ` It was detached from ${templates.length} template(s): ` +
            `${templates.join(', ')}. ${dependents.length} agent(s) still ` +
            'run with the old copy baked in — restart_agent each of them ' +
            `(${dependents.map((d) => d.id).join(', ')}) when the person ` +
            'is ready.'),
    );
  }

  @Tool({
    name: 'import_skill_from_url',
    topic: ToolTopics.Skills,
    title: 'Import a skill from GitHub',
    template: 'Import the skill at «github url»',
    description:
      'Import a skill from any GitHub link: a folder (tree/…) holding a ' +
      'SKILL.md or README.md, or a direct link to a .md file (blob/…). ' +
      'Fetches the file and its sibling files, derives a slug from the path ' +
      '(pass `name` to choose one) and saves the skill with its source URL. ' +
      'Refuses if a skill with that slug already exists unless `overwrite` ' +
      'is true, in which case it is replaced in full. Returns the saved ' +
      'skill. Attach it to a template with set_template_skills afterwards.',
    parameters: z.object({
      url: z
        .string()
        .url()
        .describe(
          'GitHub URL, e.g. https://github.com/owner/repo/tree/main/skills/my-skill',
        ),
      name: z
        .string()
        .regex(SLUG, SLUG_MESSAGE)
        .optional()
        .describe('Slug to save it under instead of the derived one'),
      overwrite: z
        .boolean()
        .optional()
        .describe('Replace a skill that already has this slug'),
    }),
  })
  async importSkillFromUrl(
    {
      url,
      name,
      overwrite,
    }: { url: string; name?: string; overwrite?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { repo, skillPath, bundle } =
      await this.github.fetchBundleFromUrl(url);
    const slug = name ?? deriveSlug(skillPath);
    return this.upsertSkill(slug, overwrite === true, {
      title: bundle.title,
      body: bundle.body,
      description: bundle.description,
      files: bundle.files,
      source: `https://github.com/${repo}/blob/HEAD/${skillPath}`,
    });
  }

  @Tool({
    name: 'import_skill',
    topic: ToolTopics.Skills,
    title: 'Import a found skill',
    template: 'Import the skill «name» from «repo»',
    description:
      'Import a skill that search_skills found: pass the `repo` and `path` ' +
      'of the hit. Fetches the SKILL.md and its sibling files, derives a ' +
      'slug from the path (pass `name` to choose one) and saves the skill ' +
      'with its source URL. Refuses if a skill with that slug already exists ' +
      'unless `overwrite` is true, in which case it is replaced in full. ' +
      'Returns the saved skill. Attach it to a template with ' +
      'set_template_skills afterwards.',
    parameters: z.object({
      repo: z
        .string()
        .describe(
          'GitHub owner/repo from the search hit, e.g. anthropics/skills',
        ),
      path: z
        .string()
        .describe('Path to the SKILL.md inside the repo, from the search hit'),
      name: z
        .string()
        .regex(SLUG, SLUG_MESSAGE)
        .optional()
        .describe('Slug to save it under instead of the derived one'),
      overwrite: z
        .boolean()
        .optional()
        .describe('Replace a skill that already has this slug'),
    }),
  })
  async importSkill(
    {
      repo,
      path,
      name,
      overwrite,
    }: { repo: string; path: string; name?: string; overwrite?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const bundle = await this.github.fetchBundle(repo, path);
    const slug = name ?? deriveSlug(path);
    return this.upsertSkill(slug, overwrite === true, {
      title: bundle.title,
      body: bundle.body,
      description: bundle.description,
      files: bundle.files,
      source: `https://github.com/${repo}/blob/HEAD/${path}`,
    });
  }

  /**
   * `SkillController.upsertSkill`, with the 409 turned into a refusal the
   * model can act on: it names the existing skill and the two ways forward.
   */
  private async upsertSkill(
    slug: string,
    overwrite: boolean,
    data: {
      title: string;
      body: string;
      description: string | null;
      files: ISkillFile[];
      source: string;
    },
  ): Promise<ToolResult> {
    const existing = await this.skills.findByName(slug);
    if (existing && !overwrite) {
      return err(
        `Skill "${slug}" already exists (id ${existing.id}, ` +
          `«${existing.title}»` +
          `${existing.source ? `, from ${existing.source}` : ''}). Ask the ` +
          'person whether to replace it — then call again with overwrite: ' +
          'true — or import it under another slug with name.',
      );
    }
    if (existing && overwrite) {
      const updated = await this.skills.update(existing.id, {
        title: data.title,
        body: data.body,
        description: data.description,
        files: data.files,
        source: data.source,
      });
      this.logger.log(`Skill replaced through MCP: ${slug} (${existing.id})`);
      return ok(updated);
    }
    const created = await this.skills.create({ name: slug, ...data });
    this.logger.log(`Skill imported through MCP: ${slug} (${created.id})`);
    return ok(created);
  }
}
