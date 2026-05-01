import { ApiProperty } from '@nestjs/swagger';
import { SecretEntryDto } from './secretEntry.dto';

export class SecretListDto {
  @ApiProperty({ enum: ['aws', 'file'], example: 'file' })
  provider!: 'aws' | 'file';

  @ApiProperty({ type: [SecretEntryDto] })
  secrets!: SecretEntryDto[];
}
