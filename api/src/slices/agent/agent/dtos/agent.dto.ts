import { ApiProperty } from '@nestjs/swagger';

export class AgentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  templateId: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ nullable: true })
  workflowId: string | null;

  @ApiProperty()
  config: Record<string, unknown>;

  @ApiProperty()
  resources: { cpu: string; memory: string };

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
