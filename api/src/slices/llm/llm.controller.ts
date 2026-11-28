import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { ChangesAssistantIngredient } from '#/agent/assistantBuild/guards';
import { AssistantBuildService } from '#/agent/assistantBuild/domain/assistantBuild.service';
import { ILlmGateway, ILlmHealthGateway } from './domain';
import {
  CreateLlmCredentialDto,
  LlmCredentialDto,
  UpdateLlmCredentialDto,
  LlmHealthCheckResultDto,
} from './dtos';

@ApiTags('llms')
@Controller('llms')
export class LlmController {
  constructor(
    private gateway: ILlmGateway,
    private health: ILlmHealthGateway,
    private build: AssistantBuildService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all LLM credentials' })
  @ApiOkResponse({ type: [LlmCredentialDto] })
  async findAll(@Req() req?: Request & { user?: IAuthTokenPayload }) {
    // The key of the credential the Ranch assistant runs on is withheld
    // from anybody but the Owner (CLEAN-271).
    return this.build.mark(
      'llmCredential',
      await this.gateway.findAll(),
      req?.user,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get LLM credential by ID' })
  @ApiOkResponse({ type: LlmCredentialDto })
  async findById(
    @Param('id') id: string,
    @Req() req?: Request & { user?: IAuthTokenPayload },
  ) {
    const record = await this.gateway.findById(id);
    if (!record) throw new NotFoundException('LLM credential not found');
    return this.build.markOne('llmCredential', record, req?.user);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new LLM credential' })
  create(@Body() dto: CreateLlmCredentialDto) {
    return this.gateway.create(dto);
  }

  @Put(':id')
  @ChangesAssistantIngredient('llmCredential', 'id')
  @ApiOperation({
    summary:
      'Update an LLM credential. The credential the Ranch assistant runs on is the Owner’s to change or delete: 403 ASSISTANT_BUILT_FROM for anybody else (CLEAN-271).',
  })
  update(@Param('id') id: string, @Body() dto: UpdateLlmCredentialDto) {
    return this.gateway.update(id, dto);
  }

  @Delete(':id')
  @ChangesAssistantIngredient('llmCredential', 'id')
  @ApiOperation({ summary: 'Delete an LLM credential' })
  remove(@Param('id') id: string) {
    return this.gateway.delete(id);
  }

  @Post(':id/health-check')
  @ApiOperation({
    summary: 'Health-check an LLM credential',
    operationId: 'healthCheckLlmCredential',
  })
  @ApiOkResponse({ type: LlmHealthCheckResultDto })
  async healthCheck(@Param('id') id: string): Promise<LlmHealthCheckResultDto> {
    const credential = await this.gateway.findById(id);
    if (!credential) throw new NotFoundException('LLM credential not found');
    return this.health.check(credential);
  }
}
