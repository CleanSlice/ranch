import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateMcpServerDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty()
  @IsString()
  url: string;

  @ApiProperty({ required: false, enum: ['streamableHttp', 'sse'] })
  @IsOptional()
  @IsIn(['streamableHttp', 'sse'])
  transport?: 'streamableHttp' | 'sse';

  @ApiProperty({ required: false, enum: ['none', 'bearer', 'header', 'oauth'] })
  @IsOptional()
  @IsIn(['none', 'bearer', 'header', 'oauth'])
  authType?: 'none' | 'bearer' | 'header' | 'oauth';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  authValue?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
