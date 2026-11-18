import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

/** More agents than any installation shows unpaged; a bound, not a quota. */
const MAX_ENTRIES = 5000;

export class SetAgentAccessDto {
  @ApiProperty({
    type: [String],
    description:
      'The agents the account is allowed, among the ones the caller ' +
      'reaches. With at least one, the account reaches only its allowed ' +
      'agents.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @IsString({ each: true })
  allowed: string[];

  @ApiProperty({
    type: [String],
    description: 'The agents the account is denied, among the same.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @IsString({ each: true })
  denied: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The `version` the access was read with; null when it was never ' +
      'edited. Refused with ACCESS_CHANGED when it is no longer current.',
  })
  @ValidateIf((dto: SetAgentAccessDto) => dto.version !== null)
  @IsString()
  version: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Required to turn a limited account into one that reaches every ' +
      'agent not denied; without it such a change is refused with ' +
      'ACCESS_OPEN_NEEDS_CONFIRM.',
  })
  @IsOptional()
  @IsBoolean()
  confirmOpen?: boolean;
}
