import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetAgentDebugDto {
  @ApiProperty({
    description:
      'When true, runtime emits prompt-debug snapshots over the bridle WS to admin clients.',
  })
  @IsBoolean()
  enabled: boolean;
}
