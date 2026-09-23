import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class SaveFileDto {
  @ApiProperty({ description: 'Full file content as text' })
  @IsString()
  content!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Refuse with 409 when the file already exists (New file).',
  })
  @IsOptional()
  @IsBoolean()
  createOnly?: boolean;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Refuse with 412 when the stored file changed after this instant (the `updatedAt` the editor loaded).',
  })
  @IsOptional()
  @IsDateString()
  ifUnmodifiedSince?: string;
}
