import { ApiProperty } from '@nestjs/swagger';

/**
 * The agent card as the console shows it (CLEAN-74). Response-only — the
 * shape mirrors the A2A 1.0 `AgentCard` so the picker preview and the "Agent
 * card" panel render exactly what another agent would read, rather than a
 * prettier summary that could drift from it.
 */
export class AgentSkillDto {
  @ApiProperty({
    description:
      'Stable id of the skill. Prefixed by where it came from: `skill:` for a ' +
      'template skill, `knowledge:` for a bound knowledge base.',
    example: 'knowledge:9a1f…',
  })
  id: string;

  @ApiProperty({ description: 'Short name.', example: 'Returns policy' })
  name: string;

  @ApiProperty({
    description:
      'What this lets the agent do, written so another agent can decide when ' +
      'to ask.',
    example: 'Answers questions about «Returns policy»: 2026 policy PDF.',
  })
  description: string;

  @ApiProperty({
    type: [String],
    description: 'Origin tags: `skill` or `knowledge`.',
    example: ['knowledge'],
  })
  tags: string[];
}

export class AgentInterfaceDto {
  @ApiProperty({
    description: 'Where another agent sends tasks for this one.',
    example: 'https://api.ranch.example/a2a/agents/6f1c…',
  })
  url: string;

  @ApiProperty({ description: 'Transport binding.', example: 'JSONRPC' })
  protocolBinding: string;

  @ApiProperty({ description: 'A2A protocol version.', example: '1.0' })
  protocolVersion: string;
}

export class AgentCapabilitiesDto {
  @ApiProperty({
    required: false,
    description: 'Whether the agent streams partial answers. Ranch: false.',
    example: false,
  })
  streaming?: boolean;

  @ApiProperty({
    required: false,
    description:
      'Whether the agent can call back when a task finishes. Ranch: false.',
    example: false,
  })
  pushNotifications?: boolean;
}

export class AgentCardDto {
  @ApiProperty({ example: 'Support Bot' })
  name: string;

  @ApiProperty({
    description: "The agent's own description, falling back to its template's.",
    example: 'Answers customer questions about orders and returns.',
  })
  description: string;

  @ApiProperty({ description: "The template's version.", example: '1' })
  version: string;

  @ApiProperty({ type: [AgentInterfaceDto] })
  supportedInterfaces: AgentInterfaceDto[];

  @ApiProperty({ type: AgentCapabilitiesDto })
  capabilities: AgentCapabilitiesDto;

  @ApiProperty({ type: [String], example: ['text/plain'] })
  defaultInputModes: string[];

  @ApiProperty({ type: [String], example: ['text/plain'] })
  defaultOutputModes: string[];

  @ApiProperty({
    type: [AgentSkillDto],
    description:
      'One entry per template skill and per bound knowledge base. May be ' +
      'empty: an agent with nothing to advertise still has a valid card.',
  })
  skills: AgentSkillDto[];
}
