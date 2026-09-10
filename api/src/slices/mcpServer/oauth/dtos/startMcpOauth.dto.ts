import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class StartMcpOauthDto {
  @ApiProperty({
    description:
      'Agent that will own the connection. The stored refresh token is scoped to this agent.',
  })
  @IsString()
  agentId: string;
}

export class McpOauthStatusDto {
  @ApiProperty()
  connected: boolean;
}

export class StartMcpOauthResultDto {
  @ApiProperty({
    description:
      'Authorization URL to hand the user. They open it, log in at the provider, and the callback stores the token.',
  })
  authorizeUrl: string;
}
