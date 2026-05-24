import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateAgentDto } from './createAgent.dto';

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
