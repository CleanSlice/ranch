import { ApiProperty } from '@nestjs/swagger';

/** One env var as the agent pod receives it. */
export class AgentEnvVarDto {
  @ApiProperty({ example: 'LOG_LEVEL' })
  name: string;

  @ApiProperty({ example: 'debug' })
  value: string;
}
