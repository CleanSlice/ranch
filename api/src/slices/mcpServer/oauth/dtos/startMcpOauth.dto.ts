import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class StartMcpOauthDto {
  @ApiProperty({
    description:
      'Agent whose secret store receives the token. The stored refresh token is scoped to this agent.',
  })
  @IsString()
  agentId: string;

  @ApiProperty({
    required: false,
    description:
      'Whose token it will be (CLEAN-80): the chat user id the hub forwarded on the message, or a share/anon client id. Omit for an agent-wide connection shared by everyone who talks to the agent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({
    required: false,
    description: 'Display only — shown back as "connected as …".',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    required: false,
    description:
      'Where the callback page sends the person after the login — the chat they started from, as an absolute URL. Honoured only on one of the platform\'s own origins (API, admin, app, localhost); otherwise the page just says to return to the chat.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  returnTo?: string;
}

export class McpOauthStatusDto {
  @ApiProperty()
  connected: boolean;

  @ApiProperty({
    required: false,
    enum: ['subject', 'agent'],
    nullable: true,
    description:
      "Which bundle answered: the subject's own, the agent-wide one, or null when none.",
  })
  scope: 'subject' | 'agent' | null;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty({ required: false, description: 'epoch ms of the login' })
  connectedAt?: number;
}

export class StartMcpOauthResultDto {
  @ApiProperty({
    description:
      'Authorization URL to hand the user. They open it, log in at the provider, and the callback stores the token.',
  })
  authorizeUrl: string;
}
