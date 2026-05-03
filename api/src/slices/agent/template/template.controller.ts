import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ITemplateGateway } from './domain';
import {
  CreateTemplateDto,
  SetTemplateSkillsDto,
  UpdateTemplateDto,
} from './dtos';

@ApiTags('templates')
@Controller('templates')
export class TemplateController {
  constructor(private templateGateway: ITemplateGateway) {}

  @Get()
  @ApiOperation({ summary: 'List all agent templates' })
  findAll() {
    return this.templateGateway.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get template by ID' })
  async findById(@Param('id') id: string) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new agent template' })
  create(@Body() dto: CreateTemplateDto) {
    return this.templateGateway.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a template' })
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templateGateway.update(id, dto);
  }

  @Put(':id/skills')
  @ApiOperation({
    summary:
      'Replace the skill set attached to a template. Body lists the full desired set; omitted IDs are detached.',
  })
  async setSkills(
    @Param('id') id: string,
    @Body() dto: SetTemplateSkillsDto,
  ) {
    const template = await this.templateGateway.findById(id);
    if (!template) throw new NotFoundException('Template not found');
    return this.templateGateway.setSkills(id, dto.skillIds);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a template' })
  remove(@Param('id') id: string) {
    return this.templateGateway.delete(id);
  }
}
