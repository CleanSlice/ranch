import { ApiProperty } from '@nestjs/swagger';

export class SkillAgentDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  templateId: string;

  @ApiProperty()
  templateName: string;
}
