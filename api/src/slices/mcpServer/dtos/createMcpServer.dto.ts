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

  @ApiProperty({ required: false, enum: ['none', 'bearer', 'header'] })
  @IsOptional()
  @IsIn(['none', 'bearer', 'header'])
  authType?: 'none' | 'bearer' | 'header';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  authValue?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
