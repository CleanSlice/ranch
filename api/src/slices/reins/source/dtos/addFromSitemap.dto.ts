import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class AddFromSitemapDto {
  @ApiProperty({ example: 'https://developer.paypal.com/sitemap.xml' })
  @IsUrl({ require_protocol: true })
  sitemapUrl: string;

  // Optional full-URL prefix used to filter which sitemap entries become
  // sources. Without it every page in the sitemap is queued, which for a
  // large docs site is rarely what the user wants.
  @ApiPropertyOptional({
    example: 'https://developer.paypal.com/docs/checkout/',
  })
  @IsOptional()
  @IsString()
  urlPrefix?: string;
}

export class AddFromSitemapResultDto {
  @ApiProperty({ example: 47 })
  added: number;

  @ApiProperty({ example: 51 })
  discovered: number;
}
