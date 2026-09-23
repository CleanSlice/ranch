import { ApiProperty } from '@nestjs/swagger';

/** Effective limits of the file slice — so no client hardcodes them (CLEAN-112). */
export class FileLimitsDto {
  @ApiProperty({ example: 1048576 })
  maxEditBytes!: number;

  @ApiProperty({ example: 26214400 })
  maxViewBytes!: number;

  @ApiProperty({ example: 262144 })
  rangeBytes!: number;

  @ApiProperty({ example: 524288 })
  maxRangeBytes!: number;

  @ApiProperty({ example: 900 })
  openLinkTtlSec!: number;

  @ApiProperty({ example: 104857600 })
  importMaxArchiveBytes!: number;

  @ApiProperty({ example: 2000 })
  importMaxEntries!: number;

  @ApiProperty({ example: 26214400 })
  importMaxFileBytes!: number;

  @ApiProperty({ example: 500 })
  importPlanListRows!: number;

  @ApiProperty({ example: 1048576 })
  diffCompareMaxBytes!: number;

  @ApiProperty({ example: 200 })
  diffInlineMaxLines!: number;

  @ApiProperty({ example: 102400 })
  diffInlineMaxBytes!: number;

  @ApiProperty({ example: 50 })
  proposalListRows!: number;

  @ApiProperty({ type: [String], example: ['.md', '.json', '.py'] })
  textExtensions!: string[];
}
