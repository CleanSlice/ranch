import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  ConflictException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { accessCallerOf } from '#/user/agentAccess/guards';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ChangesAssistantIngredient } from '#/agent/assistantBuild/guards';
import { AssistantBuildService } from '#/agent/assistantBuild/domain/assistantBuild.service';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { ISkillGateway, ISkillData } from './domain';
import { SkillOrderService } from './domain/skillOrder.service';
import { isUniqueNameViolation } from './domain/skillErrors';
import {
  CreateSkillDto,
  SkillDto,
  UpdateSkillDto,
  SearchSkillsDto,
  ImportSkillDto,
  ImportSkillUrlDto,
  SkillOrderDto,
  SaveSkillOrderDto,
  NameAvailableDto,
  NameAvailableQueryDto,
} from './dtos';
import { GithubSearch } from './data/github.search';

@ApiTags('skills')
@Controller('skills')
export class SkillController {
  constructor(
    private gateway: ISkillGateway,
    private github: GithubSearch,
    private order: SkillOrderService,
    private access: AgentAccessService,
    private build: AssistantBuildService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all skills, in the library order (sortOrder, then name)',
  })
  @ApiOkResponse({ type: [SkillDto] })
  async findAll() {
    return this.build.mark('skill', await this.gateway.findAll(), undefined);
  }

  // The three static routes below sit above `:id` on purpose: NestJS matches
  // in declaration order and `order` would otherwise be read as a skill id.

  @Get('order')
  @ApiOperation({
    operationId: 'getSkillOrder',
    summary:
      'The shared display order of the Skills page with its version (CLEAN-205)',
  })
  @ApiOkResponse({ type: SkillOrderDto })
  getOrder() {
    return this.order.read();
  }

  @Patch('order')
  @ApiOperation({
    operationId: 'saveSkillOrder',
    summary:
      'Replace the whole display order atomically. 409 ORDER_CHANGED when the ' +
      'version is stale. Agents and templates are not affected.',
  })
  @ApiOkResponse({ type: SkillOrderDto })
  saveOrder(@Body() dto: SaveSkillOrderDto) {
    return this.order.save(dto.version, dto.items);
  }

  @Get('name-available')
  @ApiOperation({
    operationId: 'skillNameAvailable',
    summary:
      'Whether a slug is free (the New / Edit skill form asks as you type)',
  })
  @ApiOkResponse({ type: NameAvailableDto })
  async nameAvailable(
    @Query() query: NameAvailableQueryDto,
  ): Promise<NameAvailableDto> {
    const existing = await this.gateway.findByName(query.name);
    const taken = existing !== null && existing.id !== query.excludeId;
    return {
      name: query.name,
      available: !taken,
      ...(taken ? { existingId: existing.id } : {}),
    };
  }

  @Get('sources')
  @ApiOperation({ summary: 'Curated GitHub repos searched for skills' })
  listSources() {
    return this.github.listSources();
  }

  @Get('search')
  @ApiOperation({ summary: 'Search skills across curated GitHub repos' })
  search(@Query() dto: SearchSkillsDto) {
    return this.github.search(dto.q);
  }

  @Post('import-url')
  @ApiOperation({
    summary: 'Import a skill from any GitHub URL (folder or SKILL.md)',
  })
  async importFromUrl(
    @Body() dto: ImportSkillUrlDto,
    @Req() req?: Request & { user?: IAuthTokenPayload },
  ) {
    const { repo, skillPath, bundle } = await this.github.fetchBundleFromUrl(
      dto.url,
    );
    const slug = dto.name ?? deriveSlug(skillPath);
    return this.upsertSkill(req, slug, dto.overwrite === true, {
      title: bundle.title,
      body: bundle.body,
      description: bundle.description,
      files: bundle.files,
      source: `https://github.com/${repo}/blob/HEAD/${skillPath}`,
    });
  }

  @Post('import')
  @ApiOperation({ summary: 'Import a skill from GitHub into the local DB' })
  async importFromGithub(
    @Body() dto: ImportSkillDto,
    @Req() req?: Request & { user?: IAuthTokenPayload },
  ) {
    const bundle = await this.github.fetchBundle(dto.repo, dto.path);
    const slug = dto.name ?? deriveSlug(dto.path);
    return this.upsertSkill(req, slug, dto.overwrite === true, {
      title: bundle.title,
      body: bundle.body,
      description: bundle.description,
      files: bundle.files,
      source: `https://github.com/${dto.repo}/blob/HEAD/${dto.path}`,
    });
  }

  private async upsertSkill(
    req: (Request & { user?: IAuthTokenPayload }) | undefined,
    slug: string,
    overwrite: boolean,
    data: {
      title: string;
      body: string;
      description: string | null;
      files: { path: string; content: string }[];
      source: string;
    },
  ) {
    const existing = await this.gateway.findByName(slug);
    if (existing && !overwrite) {
      // Structured body so the admin UI can render a confirm-overwrite modal
      // with details of the conflicting skill instead of just a flat message.
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'SKILL_EXISTS',
        message: `Skill "${slug}" already exists. Pass "overwrite": true to replace it.`,
        existing: {
          id: existing.id,
          name: existing.name,
          title: existing.title,
          description: existing.description,
          source: existing.source,
          updatedAt: existing.updatedAt,
        },
      });
    }
    if (existing && overwrite) {
      // An import that overwrites finds its target by slug, never by id: a
      // skill the Ranch assistant ships is the Owner's to replace
      // (CLEAN-271), and this is the write that would do it without ever
      // naming it. 403 ASSISTANT_BUILT_FROM, nothing written.
      await this.build.assertMayChange(req?.user, 'skill', existing.id);
      return this.gateway.update(existing.id, {
        title: data.title,
        body: data.body,
        description: data.description,
        files: data.files,
        source: data.source,
      });
    }
    return this.gateway.create({ name: slug, ...data });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get skill by ID' })
  @ApiOkResponse({ type: SkillDto })
  async findById(@Param('id') id: string) {
    const record = await this.gateway.findById(id);
    if (!record) throw new NotFoundException('Skill not found');
    return this.build.markOne('skill', record, undefined);
  }

  @Get(':id/agents')
  @ApiOperation({
    operationId: 'findDependentAgents',
    summary:
      'List agents that use this skill via their template. Drives the post-edit "Redeploy N agents" flow — skills are baked into agent pods at deploy time, so a skill update has no effect until those agents restart.',
  })
  async findDependentAgents(@Param('id') id: string, @Req() req?: Request) {
    // Only the agents the caller reaches (CLEAN-231): the list names them.
    const reach = await this.access.reachableIds(accessCallerOf(req));
    return reach.filter(
      await this.gateway.findDependentAgents(id),
      (agent) => agent.id,
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new skill (409 SKILL_EXISTS when the name is taken)',
  })
  create(@Body() dto: CreateSkillDto) {
    return this.nameTakenAs409(dto.name, () => this.gateway.create(dto));
  }

  @Put(':id')
  @ChangesAssistantIngredient('skill', 'id')
  @ApiOperation({
    summary:
      'Update a skill (409 SKILL_EXISTS when a new name is taken). A skill the Ranch assistant’s template ships is the Owner’s to change or delete: 403 ASSISTANT_BUILT_FROM for anybody else (CLEAN-271).',
  })
  update(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.nameTakenAs409(dto.name, () => this.gateway.update(id, dto));
  }

  /**
   * The form checks the slug as the admin types, but two tabs can still race
   * to the same name; the unique index wins and this turns Prisma's P2002
   * into the same 409 the import path uses, so the field can show the error.
   */
  private async nameTakenAs409(
    name: string | undefined,
    write: () => Promise<ISkillData>,
  ): Promise<ISkillData> {
    try {
      return await write();
    } catch (error) {
      if (!isUniqueNameViolation(error)) throw error;
      const existing = name ? await this.gateway.findByName(name) : null;
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'SKILL_EXISTS',
        message: `Skill "${name ?? ''}" already exists.`,
        existing: existing
          ? { id: existing.id, name: existing.name, title: existing.title }
          : null,
      });
    }
  }

  @Delete(':id')
  @ChangesAssistantIngredient('skill', 'id')
  @ApiOperation({ summary: 'Delete a skill' })
  remove(@Param('id') id: string) {
    return this.gateway.delete(id);
  }
}

/** Exported so `skill.tool.ts` derives the same slug the console import does. */
export function deriveSlug(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const fname = parts.pop() ?? '';
  const parent = parts.pop();
  const raw =
    parent && parent !== 'skills' ? parent : fname.replace(/\.md$/i, '');
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill'
  );
}
