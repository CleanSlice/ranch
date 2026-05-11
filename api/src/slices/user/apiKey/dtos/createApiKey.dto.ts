import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiKeyScopeTypes } from '../domain';

export class CreateApiKeyDto {
  @ApiProperty({ example: 'Marketing site embed' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({
    isArray: true,
    enum: ApiKeyScopeTypes,
    enumName: 'ApiKeyScopeTypes',
    example: [ApiKeyScopeTypes.EmbedMint],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(ApiKeyScopeTypes, { each: true })
  scopes: ApiKeyScopeTypes[];

  @ApiPropertyOptional({
    description: 'ISO date string. Omit for a non-expiring key.',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
