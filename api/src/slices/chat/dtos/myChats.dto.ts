import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

// Longer than any piece of a title or a preview worth typing; it bounds the
// query the text ends up in.
const MAX_SEARCH_LENGTH = 100;

/** Trimmed; a blank search is no search. Anything not a string is left to fail. */
const toSearch = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  return text === '' ? undefined : text;
};

/**
 * Query for the end-user "my history" list. The caller only ever sees their
 * own bridle chats (scoped server-side by the token), and nothing here can
 * widen that: no channel, no other person. `agentId` and `search` narrow the
 * same rows further (CLEAN-248: history is shown inside one agent). The
 * agent named is checked by `@AgentScoped` on the route.
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

  @ApiPropertyOptional({
    description: 'Only conversations with this agent',
  })
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SEARCH_LENGTH,
    description:
      'Title or last message contains this text, case-insensitive. ' +
      'Blank is the same as absent.',
  })
  @IsOptional()
  @Transform(toSearch)
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  search?: string;

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
