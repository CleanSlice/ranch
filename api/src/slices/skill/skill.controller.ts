import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ISkillGateway } from './domain';
import {
  CreateSkillDto,
  UpdateSkillDto,
  SearchSkillsDto,
  ImportSkillDto,
  ImportSkillUrlDto,
} from './dtos';
import { GithubSearch } from './data/github.search';

@ApiTags('skills')
@Controller('skills')
export class SkillController {
  constructor(
    private gateway: ISkillGateway,
    private github: GithubSearch,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all skills' })
  findAll() {
    return this.gateway.findAll();
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
  async importFromUrl(@Body() dto: ImportSkillUrlDto) {
    const { repo, skillPath, bundle } = await this.github.fetchBundleFromUrl(
      dto.url,
    );
    const slug = dto.name ?? deriveSlug(skillPath);
    const existing = await this.gateway.findAll();
    if (existing.some((s) => s.name === slug)) {
      throw new ConflictException(
        `Skill "${slug}" already exists. Pass a different "name" to override.`,
      );
    }
    return this.gateway.create({
      name: slug,
      title: bundle.title,
      body: bundle.body,
      description: bundle.description,
      files: bundle.files,
      source: `https://github.com/${repo}/blob/HEAD/${skillPath}`,
    });
  }

  @Post('import')
  @ApiOperation({ summary: 'Import a skill from GitHub into the local DB' })
  async importFromGithub(@Body() dto: ImportSkillDto) {
    const bundle = await this.github.fetchBundle(dto.repo, dto.path);
    const slug = dto.name ?? deriveSlug(dto.path);
    const existing = await this.gateway.findAll();
    if (existing.some((s) => s.name === slug)) {
      throw new ConflictException(
        `Skill "${slug}" already exists. Pass a different "name" to override.`,
      );
    }
    return this.gateway.create({
      name: slug,
      title: bundle.title,
      body: bundle.body,
      description: bundle.description,
      files: bundle.files,
      source: `https://github.com/${dto.repo}/blob/HEAD/${dto.path}`,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get skill by ID' })
  async findById(@Param('id') id: string) {
    const record = await this.gateway.findById(id);
    if (!record) throw new NotFoundException('Skill not found');
    return record;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new skill' })
  create(@Body() dto: CreateSkillDto) {
    return this.gateway.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a skill' })
  update(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.gateway.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a skill' })
  remove(@Param('id') id: string) {
    return this.gateway.delete(id);
  }
}

function deriveSlug(path: string): string {
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
