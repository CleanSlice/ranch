import { ApiProperty } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class InstallFromGitDto {
  @ApiProperty({
    description:
      'Git URL — https://, http://, git@host:..., or ssh://host/.../repo.git',
    example: 'https://github.com/CleanSlice/agent-templates.git',
  })
  @IsString()
  @MaxLength(1000)
  gitUrl!: string;

  @ApiProperty({
    description:
      'Optional ref — branch, tag, or short SHA. Defaults to the remote default branch.',
    required: false,
    example: 'main',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  gitRef?: string;

  @ApiProperty({
    description:
      'Operator-supplied params (e.g. {"language":"ru"}). Validated against the manifest at install time.',
    required: false,
    additionalProperties: true,
  })
  @IsObject()
  @IsOptional()
  params?: Record<string, string | number | boolean>;
}
