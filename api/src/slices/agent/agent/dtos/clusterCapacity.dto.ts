import { ApiProperty } from '@nestjs/swagger';

export class NodeCapacityDto {
  @ApiProperty({ example: 'k3s-agent-gnk' })
  name: string;

  @ApiProperty({
    example: 3200,
    description: 'Allocatable CPU minus summed pod requests, in millicores',
  })
  freeCpuMilli: number;

  @ApiProperty({
    example: 6442450944,
    description: 'Allocatable memory minus summed pod requests, in bytes',
  })
  freeMemBytes: number;

  @ApiProperty({
    example: 12,
    description: 'How many more agent pods fit on this node',
  })
  freeSlots: number;
}

export class ClusterCapacityDto {
  @ApiProperty({
    example: 12,
    description:
      'How many more agents can start right now, across all agent nodes',
  })
  freeAgentSlots: number;

  @ApiProperty({
    example: 8,
    description: 'Agents currently holding a slot (live pods + deploying)',
  })
  usedAgentSlots: number;

  @ApiProperty({
    example: 20,
    description: 'usedAgentSlots + freeAgentSlots under current cluster load',
  })
  totalAgentSlots: number;

  @ApiProperty({
    example: 100,
    description: 'CPU request one agent slot reserves, in millicores',
  })
  slotCpuMilli: number;

  @ApiProperty({
    example: 536870912,
    description: 'Memory request one agent slot reserves, in bytes',
  })
  slotMemBytes: number;

  @ApiProperty({ type: NodeCapacityDto, isArray: true })
  nodes: NodeCapacityDto[];

  @ApiProperty({ example: '2026-07-29T12:00:00.000Z' })
  observedAt: string;
}
