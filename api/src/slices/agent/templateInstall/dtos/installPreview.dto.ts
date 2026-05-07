import { ApiProperty } from '@nestjs/swagger';

export class InstallDeclaredSkillDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  resolved!: boolean;
}

export class InstallDeclaredMcpDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  resolved!: boolean;
}

export class InstallDeclaredSecretDto {
  @ApiProperty()
  name!: string;
  @ApiProperty()
  required!: boolean;
}

export class InstallDeclaredDto {
  @ApiProperty({ type: [InstallDeclaredSkillDto] })
  skills!: InstallDeclaredSkillDto[];

  @ApiProperty({ type: [InstallDeclaredMcpDto] })
  mcp!: InstallDeclaredMcpDto[];

  @ApiProperty({ type: [InstallDeclaredSecretDto] })
  secrets!: InstallDeclaredSecretDto[];
}

export class InstallFileCountsDto {
  @ApiProperty()
  agentFiles!: number;
  @ApiProperty()
  scenarioFiles!: number;
}

export class InstallPreviewDto {
  @ApiProperty({
    description:
      'The parsed manifest. Returned as raw JSON so the UI can render any field without typed coupling.',
    type: 'object',
    additionalProperties: true,
  })
  manifest!: Record<string, unknown>;

  @ApiProperty()
  willCreate!: boolean;

  @ApiProperty()
  willUpgrade!: boolean;

  @ApiProperty({ required: false })
  existingTemplateId?: string;

  @ApiProperty({ type: InstallDeclaredDto })
  declared!: InstallDeclaredDto;

  @ApiProperty({ type: InstallFileCountsDto })
  files!: InstallFileCountsDto;

  @ApiProperty({ type: [String] })
  warnings!: string[];
}
