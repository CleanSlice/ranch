import { ApiProperty } from '@nestjs/swagger';

export class SecretEntryDto {
  @ApiProperty({ example: 'user-abc/openai_api_key' })
  name!: string;

  @ApiProperty({ example: 'sk-...' })
  value!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  updatedAt!: string | null;
}
