import { ApiProperty } from '@nestjs/swagger';
import {
  TOOL_PHASES,
  TOOL_SERVER_STATES,
  ToolPhaseTypes,
  ToolServerStateTypes,
} from '../domain/toolState.types';

export class AgentToolServerDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      "Ranch's id of the server, when the agent's config carried one.",
    example: 'mcp-documents',
  })
  id: string | null;

  @ApiProperty({ example: 'Documents' })
  name: string;

  @ApiProperty({
    enum: TOOL_SERVER_STATES,
    description:
      '`connected`; `retrying` — it does not answer and the runtime keeps trying; `refused` — it answered 401/403, which waiting does not fix: its credentials need changing.',
  })
  state: ToolServerStateTypes;

  @ApiProperty({
    description: 'When it entered this state.',
    example: '2026-11-20T09:10:52.368Z',
  })
  since: string;

  @ApiProperty({
    description: 'Attempts since it last was connected; 0 when connected.',
    example: 14,
  })
  attempts: number;

  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The last failure, first line, without credentials. Null when connected.',
    example: 'HTTP 503',
  })
  lastError: string | null;
}

/**
 * What a running agent says about its tool servers (CLEAN-245) — for the
 * people who manage it. Everyone else reads one word of it: `toolState` on
 * the agent.
 */
export class AgentToolStateDto {
  @ApiProperty({
    enum: TOOL_PHASES,
    description:
      '`connecting` — just started and still reaching some servers; `limited` — running without some of them; `ready` — all connected.',
  })
  phase: ToolPhaseTypes;

  @ApiProperty({
    description: 'When this phase began.',
    example: '2026-11-20T09:10:52.368Z',
  })
  since: string;

  @ApiProperty({ type: [AgentToolServerDto] })
  servers: AgentToolServerDto[];
}
