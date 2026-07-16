import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SyncChatsDto {
  @ApiPropertyOptional({
    description: 'Reconcile only this agent; omit for all agents',
  })
  @IsOptional()
  @IsString()
  agentId?: string;
}

export class SyncChatsResponseDto {
  @ApiProperty() scannedAgents: number;
  @ApiProperty() scannedFiles: number;
  @ApiProperty() upserted: number;
  @ApiProperty() skipped: number;
}
