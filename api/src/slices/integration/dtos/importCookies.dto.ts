import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImportCookiesCookieDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(8192)
  value: string;

  @ApiProperty({ example: '.instagram.com' })
  @IsString()
  @MaxLength(255)
  domain: string;

  @ApiProperty({ example: '/' })
  @IsString()
  @MaxLength(255)
  path: string;

  @ApiProperty({ description: 'Unix seconds, or -1 for session cookie' })
  @IsInt()
  expires: number;

  @ApiProperty()
  @IsBoolean()
  httpOnly: boolean;

  @ApiProperty()
  @IsBoolean()
  secure: boolean;

  @ApiProperty({ enum: ['Strict', 'Lax', 'None'] })
  @IsIn(['Strict', 'Lax', 'None'])
  sameSite: 'Strict' | 'Lax' | 'None';
}

export class ImportCookiesDto {
  @ApiProperty({
    type: [ImportCookiesCookieDto],
    description:
      'Cookies in Playwright storageState shape. Either harvested by the Ranch extension or pasted from any third-party cookie-exporter (Cookie-Editor, EditThisCookie, etc.).',
  })
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportCookiesCookieDto)
  cookies: ImportCookiesCookieDto[];

  @ApiPropertyOptional({
    description:
      'Per-origin localStorage entries. Most extensions do not collect these — accepted optionally for future-proofing.',
  })
  @IsOptional()
  @IsArray()
  origins?: unknown[];

  @ApiPropertyOptional({
    description:
      'User-Agent of the browser that issued the cookies. CRITICAL — Instagram/Meta invalidate sessions whose UA shifts between captures and replays. The runtime applies this verbatim to its Playwright context.',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}
