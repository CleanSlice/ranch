import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { ImportPlanEntryDto, ImportCountsDto } from './importPlan.dto';

/** What the card lists for a set (import) proposal. */
export class ProposalSetSummaryDto {
  @ApiProperty({ type: ImportCountsDto })
  counts!: ImportCountsDto;

  @ApiProperty({ type: [ImportPlanEntryDto], description: 'First rows only.' })
  rows!: ImportPlanEntryDto[];

  @ApiProperty({ example: 0, description: 'Rows not listed.' })
  more!: number;

  @ApiProperty({ enum: ['merge', 'replace'] })
  mode!: 'merge' | 'replace';

  @ApiProperty()
  includeSessions!: boolean;

  @ApiProperty({ nullable: true, type: String })
  wrapperStripped!: string | null;

  @ApiProperty({ type: [String] })
  warnings!: string[];
}

/** A change an agent proposed through a confirm-gated file tool (CLEAN-112). */
export class FileChangeProposalDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Target workspace.' })
  agentId!: string;

  @ApiProperty()
  agentName!: string;

  @ApiProperty({ description: 'The agent whose chat raised it.' })
  chatAgentId!: string;

  @ApiProperty({ example: 'admin' })
  channel!: string;

  @ApiProperty({ enum: ['single', 'set'] })
  kind!: 'single' | 'set';

  @ApiProperty({ enum: ['write', 'create', 'import'] })
  op!: 'write' | 'create' | 'import';

  @ApiProperty({ nullable: true, type: String, example: 'agent.config.json' })
  path!: string | null;

  @ApiProperty({ nullable: true, enum: ['merge', 'replace', null] })
  mode!: 'merge' | 'replace' | null;

  @ApiProperty()
  includeSessions!: boolean;

  @ApiProperty({ example: 856 })
  proposedBytes!: number;

  @ApiProperty({ enum: ['ok', 'too_large', 'binary', 'none'] })
  diffStatus!: 'ok' | 'too_large' | 'binary' | 'none';

  @ApiProperty({ nullable: true, type: Number })
  additions!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  deletions!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  changedLines!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  firstChangedLine!: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Unified diff hunks; null when over the inline caps or not computed.',
  })
  inlineDiff!: string | null;

  @ApiProperty({ nullable: true, type: ProposalSetSummaryDto })
  summary!: ProposalSetSummaryDto | null;

  @ApiProperty({ enum: ['pending', 'applied', 'skipped', 'stale', 'refused'] })
  status!: 'pending' | 'applied' | 'skipped' | 'stale' | 'refused';

  @ApiProperty({ nullable: true, type: String })
  actedBy!: string | null;

  @ApiProperty({ nullable: true, enum: ['card', 'tool', 'editor', null] })
  actedVia!: 'card' | 'tool' | 'editor' | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  actedAt!: string | null;

  @ApiProperty({
    nullable: true,
    type: Object,
    description: 'ImportResult for a set; `{ etag }` for a single.',
  })
  result!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, type: String })
  reason!: string | null;

  @ApiProperty({ description: 'The target agent is running — applies on its next restart.' })
  restartRequired!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ListProposalsQueryDto {
  @ApiProperty({ description: 'The agent whose chat raised the proposals.' })
  @IsString()
  chatAgentId!: string;

  @ApiPropertyOptional({ default: 'admin' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  since?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  until?: string;
}

export class ProposalDiffQueryDto {
  @ApiPropertyOptional({ description: 'Set proposals: which entry to compare.' })
  @IsOptional()
  @IsString()
  path?: string;
}

export class ApplyProposalDto {
  @ApiPropertyOptional({ enum: ['card', 'editor'], default: 'card' })
  @IsOptional()
  @IsIn(['card', 'editor'])
  via?: 'card' | 'editor';

  @ApiPropertyOptional({
    description: 'Editor only — the edited content replaces the proposed one.',
  })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    description: 'Replace-mode imports that remove files need this acknowledgement.',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  confirmRemove?: boolean;
}

export class ProposalRemoveConflictDto {
  @ApiProperty({ example: true })
  requiresConfirmation!: true;

  @ApiProperty({ example: 12, description: 'Files replace mode would delete.' })
  remove!: number;
}
