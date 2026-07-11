import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class AdminEmbedTokenDto {
  @ApiPropertyOptional({
    description:
      'Duration string (s/m/h/d). Defaults to 12h; capped at 7d — admin embed tokens end up in page markup, so long TTLs are refused.',
    example: '12h',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d+[smhd]$/)
  expiresIn?: string;
}
