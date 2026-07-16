import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

/**
 * Query for the end-user "my history" list. Deliberately narrow: no agentId /
 * channel / search — the current user only ever sees their own bridle chats
 * (scoped server-side by JWT `sub`), so those admin filters must not be exposed.
 */
export class MyChatsQueryDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Include archived chats',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  archived?: boolean;

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
