import { ApiProperty } from '@nestjs/swagger';
import type { IBridleHealthData, IBridleAgentHealthData } from '../domain';

export class BridleHealthDto implements IBridleHealthData {
  @ApiProperty({ example: true })
  ok: boolean;

  @ApiProperty({
    description: 'Whether any agent runtime is connected via WebSocket',
  })
  agentConnected: boolean;

  @ApiProperty({ description: 'Number of browser clients connected' })
  browserClients: number;
}

export class BridleAgentHealthDto implements IBridleAgentHealthData {
  @ApiProperty({ example: true })
  ok: boolean;

  @ApiProperty({
    description: 'Whether this agent is connected via WebSocket',
  })
  agentConnected: boolean;

  @ApiProperty({
    description: 'Number of browser clients connected to this agent',
  })
  browserClients: number;

  @ApiProperty({ description: 'Bot identifier' })
  agentId: string;
}
