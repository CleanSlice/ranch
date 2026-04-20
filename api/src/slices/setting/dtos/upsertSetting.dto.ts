import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsEnum } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({ enum: ['string', 'json'], default: 'string' })
  @IsEnum(['string', 'json'])
  valueType: 'string' | 'json';

  @ApiProperty({
    description: 'String for valueType=string; any JSON for valueType=json',
  })
  @IsDefined()
  value: unknown;
}
