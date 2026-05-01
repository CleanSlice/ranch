import {
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IAgentGateway } from '#/agent/agent/domain';
import { ISecretGateway } from './domain';
import { SecretListDto } from './dtos';

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
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');
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
