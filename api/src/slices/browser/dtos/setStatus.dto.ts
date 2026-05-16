import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { BrowserSessionStatusTypes } from '../domain';

export class SetStatusDto {
  @ApiProperty({ enum: BrowserSessionStatusTypes })
  @IsEnum(BrowserSessionStatusTypes)
  status: BrowserSessionStatusTypes;
}
