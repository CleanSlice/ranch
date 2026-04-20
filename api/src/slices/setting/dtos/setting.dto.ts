import { ApiProperty } from '@nestjs/swagger';

export class SettingDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  group: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ enum: ['string', 'json'] })
  valueType: string;

  @ApiProperty()
  value: unknown;

  @ApiProperty()
  updatedAt: Date;
}
