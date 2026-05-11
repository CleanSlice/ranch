import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { IApiKeyGateway, ApiKeyService } from './domain';
import { ApiKeyDto, CreateApiKeyDto, CreatedApiKeyDto } from './dtos';
import { IAuthTokenPayload } from '../auth/domain/auth.types';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/guards';
import { UserRoleTypes } from '../user/domain';

@ApiTags('api-keys')
@ApiBearerAuth()
@Controller('api-keys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
export class ApiKeyController {
  constructor(
    private gateway: IApiKeyGateway,
    private service: ApiKeyService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all API keys' })
  findAll(): Promise<ApiKeyDto[]> {
    return this.service.list();
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a new API key. The plaintext key is returned exactly once — only its hash is persisted.',
  })
  async create(
    @Body() dto: CreateApiKeyDto,
    @Req() req: Request & { user: IAuthTokenPayload },
  ): Promise<CreatedApiKeyDto> {
    return this.service.create({
      name: dto.name,
      scopes: dto.scopes,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: req.user.sub,
    });
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke (delete) an API key.' })
  async remove(@Param('id') id: string): Promise<void> {
    const found = await this.gateway.findById(id);
    if (!found) throw new NotFoundException('API key not found');
    await this.service.revoke(id);
  }
}
