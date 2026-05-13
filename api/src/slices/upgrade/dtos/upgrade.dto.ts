import { ApiProperty } from '@nestjs/swagger';

export class UpgradeStatusDto {
  @ApiProperty()
  eligible!: boolean;

  @ApiProperty({ required: false })
  reason?: string;

  @ApiProperty()
  currentVersion!: string;

  @ApiProperty({ required: false })
  branch?: string;

  @ApiProperty({ required: false })
  dirty?: boolean;
}

export class UpgradeStageDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  durationMs!: number;

  @ApiProperty({ required: false })
  output?: string;
}

export class UpgradeResultDto {
  @ApiProperty()
  versionBefore!: string;

  @ApiProperty()
  versionAfter!: string;

  @ApiProperty({ type: [UpgradeStageDto] })
  stages!: UpgradeStageDto[];
}
