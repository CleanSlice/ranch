import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateAgentDto } from './createAgent.dto';

// There is no `pinned` here (CLEAN-231): a pin is personal and is set through
// PUT / DELETE /agents/:id/pin. The update route refuses a body that still
// carries the old field instead of dropping it silently.
export class UpdateAgentDto extends PartialType(CreateAgentDto) {
  @ApiPropertyOptional({
    description:
      'Enable debug mode — emits the prompt-debug event stream and verbose ' +
      'pod logs (LOG_LEVEL=debug). The verbose-log half applies on the next ' +
      'agent restart; the prompt-debug stream flips live.',
  })
  @IsOptional()
  @IsBoolean()
  debugEnabled?: boolean;
}
