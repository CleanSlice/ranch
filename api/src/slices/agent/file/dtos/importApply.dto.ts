import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/** Body of `POST /agents/:id/files/import/:importId/apply`. */
export class ImportApplyDto {
  @ApiProperty({
    enum: ['merge', 'replace'],
    description:
      '`merge` writes the archive and keeps everything else; `replace` also deletes files not in the archive.',
  })
  @IsIn(['merge', 'replace'])
  mode!: 'merge' | 'replace';

  @ApiPropertyOptional({
    default: false,
    description: 'Also write (and in replace mode remove) runtime session state.',
  })
  @IsOptional()
  @IsBoolean()
  includeSessions?: boolean;

  @ApiPropertyOptional({
    default: false,
    description:
      'Required when `mode=replace` would remove files — the second acknowledgement.',
  })
  @IsOptional()
  @IsBoolean()
  confirmRemove?: boolean;
}
