import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKeyScopeTypes } from '../domain';

export class ApiKeyDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ description: 'Last 4 chars of the key, for display only' })
  prefix: string;

  @ApiProperty({
    isArray: true,
    enum: ApiKeyScopeTypes,
    enumName: 'ApiKeyScopeTypes',
    example: [ApiKeyScopeTypes.EmbedMint],
  })
  scopes: ApiKeyScopeTypes[];

  @ApiPropertyOptional({ nullable: true })
  lastUsedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  expiresAt: Date | null;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: Date;
}
