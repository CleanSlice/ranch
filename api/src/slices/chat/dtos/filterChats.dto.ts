import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

export class FilterChatsDto {
  @ApiPropertyOptional({ description: 'Restrict to one agent' })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ enum: ['bridle', 'telegram', 'slack', 'internal'] })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ description: 'Matches title / preview / externalUserId' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: false, description: 'Show archived sessions' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  archived?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Include internal (cron/heartbeat) sessions' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeInternal?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
