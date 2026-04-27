import { ApiProperty } from '@nestjs/swagger';

export class GraphNodeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  entityType: string;

  @ApiProperty()
  description: string;
}

export class GraphEdgeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  source: string;

  @ApiProperty()
  target: string;

  @ApiProperty()
  weight: number;

  @ApiProperty()
  keywords: string;

  @ApiProperty()
  description: string;
}

export class GraphDto {
  @ApiProperty({ type: [GraphNodeDto] })
  nodes: GraphNodeDto[];

  @ApiProperty({ type: [GraphEdgeDto] })
  edges: GraphEdgeDto[];

  @ApiProperty()
  isTruncated: boolean;
}
