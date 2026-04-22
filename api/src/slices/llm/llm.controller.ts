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
import { ILlmGateway } from './domain';
import { CreateLlmCredentialDto, UpdateLlmCredentialDto } from './dtos';

@ApiTags('llms')
@Controller('llms')
export class LlmController {
  constructor(private gateway: ILlmGateway) {}

  @Get()
  @ApiOperation({ summary: 'List all LLM credentials' })
  findAll() {
    return this.gateway.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get LLM credential by ID' })
  async findById(@Param('id') id: string) {
    const record = await this.gateway.findById(id);
    if (!record) throw new NotFoundException('LLM credential not found');
    return record;
  }

  @Post()
  @ApiOperation({ summary: 'Create a new LLM credential' })
  create(@Body() dto: CreateLlmCredentialDto) {
    return this.gateway.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an LLM credential' })
  update(@Param('id') id: string, @Body() dto: UpdateLlmCredentialDto) {
    return this.gateway.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an LLM credential' })
  remove(@Param('id') id: string) {
    return this.gateway.delete(id);
  }
}
