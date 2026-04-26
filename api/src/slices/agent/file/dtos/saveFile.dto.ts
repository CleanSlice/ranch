import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SaveFileDto {
  @ApiProperty({ description: 'Full file content as text' })
  @IsString()
  content!: string;
}
