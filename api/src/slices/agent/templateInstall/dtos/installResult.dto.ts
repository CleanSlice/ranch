import { ApiProperty } from '@nestjs/swagger';

export class InstallResultDto {
  @ApiProperty()
  templateId!: string;

  @ApiProperty()
  templateName!: string;

  @ApiProperty()
  filesUploaded!: number;

  @ApiProperty()
  scenariosSeeded!: number;

  @ApiProperty({ type: [String] })
  mcpAttached!: string[];

  @ApiProperty({ type: [String] })
  skillsAttached!: string[];

  @ApiProperty({ type: [String] })
  unresolvedMcp!: string[];

  @ApiProperty({ type: [String] })
  unresolvedSkills!: string[];

  @ApiProperty({ type: [String] })
  warnings!: string[];
}
