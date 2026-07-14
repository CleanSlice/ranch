import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DeleteFileQueryDto {
  @ApiProperty({ example: 'skills/x-poster/SKILL.md' })
  @IsString()
  path!: string;

  @ApiPropertyOptional({
    default: false,
    description:
      'When true, `path` is treated as a folder and every file under it is deleted.',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  recursive?: boolean;
}
