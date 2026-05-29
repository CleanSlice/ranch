import { ApiProperty } from '@nestjs/swagger';

export class AgentPodMetricsDto {
  @ApiProperty({ example: 234, description: 'Current CPU usage in millicores' })
  cpuMilli: number;

  @ApiProperty({ example: 471859200, description: 'Current memory usage in bytes' })
  memBytes: number;

  @ApiProperty({ example: 2000, description: 'CPU limit in millicores' })
  cpuLimitMilli: number;

  @ApiProperty({ example: 2147483648, description: 'Memory limit in bytes' })
  memLimitBytes: number;
}

export class AgentNodeMetricsDto {
  @ApiProperty({ example: 'k3s-agent-gnk' })
  name: string;

  @ApiProperty({ example: 157109764096 })
  diskAvailBytes: number;

  @ApiProperty({ example: 163817959424 })
  diskCapacityBytes: number;
}

export class AgentMetricsDto {
  @ApiProperty({ type: AgentPodMetricsDto })
  pod: AgentPodMetricsDto;

  @ApiProperty({ type: AgentNodeMetricsDto })
  node: AgentNodeMetricsDto;
}
