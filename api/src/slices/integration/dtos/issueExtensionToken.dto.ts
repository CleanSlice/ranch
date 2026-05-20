import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class IssueIntegrationExtensionTokenDto {
  @ApiPropertyOptional({
    description: 'Token lifetime in days. Defaults to 30; max 365.',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  ttlDays?: number;
}

export class IssueIntegrationExtensionTokenResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty({ description: 'Unix seconds' })
  exp: number;
}
