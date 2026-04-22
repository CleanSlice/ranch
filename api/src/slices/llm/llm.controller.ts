import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ILlmGateway } from './domain';
import { CreateLlmCredentialDto, UpdateLlmCredentialDto } from './dtos';
import { BridleApiKeyGuard } from '#/bridle/guards/bridleApiKey.guard';

@ApiTags('llms')
@Controller()
export class LlmController {
  constructor(private gateway: ILlmGateway) {}

  @Get('llms')
  @ApiOperation({ summary: 'List all LLM credentials' })
  findAll() {
    return this.gateway.findAll();
  }

  @Get('agents/:agentId/llms')
  @UseGuards(BridleApiKeyGuard)
  @ApiHeader({ name: 'x-bridle-api-key', required: true })
  @ApiOperation({
    summary: 'Active LLM credentials for an agent — called on agent boot',
  })
  findActiveForAgent() {
    return this.gateway.findActive();
  }

  @Get('llms/:id')
  @ApiOperation({ summary: 'Get LLM credential by ID' })
  async findById(@Param('id') id: string) {
    const record = await this.gateway.findById(id);
    if (!record) throw new NotFoundException('LLM credential not found');
    return record;
  }

  @Post('llms')
  @ApiOperation({ summary: 'Create a new LLM credential' })
  create(@Body() dto: CreateLlmCredentialDto) {
    return this.gateway.create(dto);
  }

  @Put('llms/:id')
  @ApiOperation({ summary: 'Update an LLM credential' })
  update(@Param('id') id: string, @Body() dto: UpdateLlmCredentialDto) {
    return this.gateway.update(id, dto);
  }

  @Delete('llms/:id')
  @ApiOperation({ summary: 'Delete an LLM credential' })
  remove(@Param('id') id: string) {
    return this.gateway.delete(id);
  }
}
