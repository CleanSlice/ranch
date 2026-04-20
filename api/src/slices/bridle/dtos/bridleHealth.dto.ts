import { ApiProperty } from '@nestjs/swagger'
import type { IBridleHealthData, IBridleBotHealthData } from '../domain'

export class BridleHealthDto implements IBridleHealthData {
  @ApiProperty({ example: true })
  ok: boolean

  @ApiProperty({ description: 'Whether any agent runtime is connected via WebSocket' })
  agentConnected: boolean

  @ApiProperty({ description: 'Number of browser clients connected' })
  browserClients: number
}

export class BridleBotHealthDto implements IBridleBotHealthData {
  @ApiProperty({ example: true })
  ok: boolean

  @ApiProperty({ description: 'Whether this bot agent is connected via WebSocket' })
  agentConnected: boolean

  @ApiProperty({ description: 'Number of browser clients connected to this bot' })
  browserClients: number

  @ApiProperty({ description: 'Bot identifier' })
  botId: string
}
