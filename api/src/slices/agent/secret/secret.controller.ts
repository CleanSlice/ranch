import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { ISecretGateway } from './domain';
import {
  SecretListDto,
  SetSecretDto,
  DeleteSecretDto,
  ReplaceSecretsDto,
} from './dtos';

@ApiTags('secrets')
@Controller('agents/:agentId/secrets')
export class SecretController {
  constructor(
    private agentGateway: IAgentGateway,
    private secretGateway: ISecretGateway,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List secrets stored for an agent. AWS source pulls from AWS Secrets Manager (aws_secret_prefix/<agentId>); file source lists S3 under agents/<agentId>/data/secrets/.',
  })
  @ApiOkResponse({ type: SecretListDto })
  async list(@Param('agentId') agentId: string): Promise<SecretListDto> {
    return this.buildList(agentId);
  }

  @Put()
  @ApiOperation({
    summary:
      'Create or update a secret for an agent (upsert). Returns the full secret list.',
  })
  @ApiOkResponse({ type: SecretListDto })
  async set(
    @Param('agentId') agentId: string,
    @Body() body: SetSecretDto,
  ): Promise<SecretListDto> {
    await this.requireAgent(agentId);
    await this.secretGateway.set(agentId, body.key, body.value);
    return this.buildList(agentId);
  }

  @Delete()
  @ApiOperation({
    summary:
      'Delete a secret for an agent. No-op if the key does not exist. Returns the full secret list.',
  })
  @ApiOkResponse({ type: SecretListDto })
  async delete(
    @Param('agentId') agentId: string,
    @Body() body: DeleteSecretDto,
  ): Promise<SecretListDto> {
    await this.requireAgent(agentId);
    await this.secretGateway.delete(agentId, body.key);
    return this.buildList(agentId);
  }

  @Post('replace')
  @ApiOperation({
    summary:
      "Atomic full-store replace. Mirrors AWS Secrets Manager's plaintext-edit semantics — the whole agent secret store becomes the supplied object. Returns the full secret list.",
  })
  @ApiOkResponse({ type: SecretListDto })
  async replace(
    @Param('agentId') agentId: string,
    @Body() body: ReplaceSecretsDto,
  ): Promise<SecretListDto> {
    await this.requireAgent(agentId);
    await this.secretGateway.replaceAll(agentId, body.store);
    return this.buildList(agentId);
  }

  private async requireAgent(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
  }

  private async buildList(agentId: string): Promise<SecretListDto> {
    await this.requireAgent(agentId);
    const data = await this.secretGateway.list(agentId);
    return {
      provider: data.provider,
      secrets: data.secrets.map((s) => ({
        name: s.name,
        value: s.value,
        updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
      })),
    };
  }
}
