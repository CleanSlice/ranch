import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SaveTemplateFileDto {
  @ApiProperty({ description: 'Full file content as text' })
  @IsString()
  content!: string;
}
