import { OmitType, PartialType } from '@nestjs/swagger';
import { CreatePaddockScenarioDto } from './createPaddockScenario.dto';

export class UpdatePaddockScenarioDto extends PartialType(
  OmitType(CreatePaddockScenarioDto, ['templateId', 'agentId'] as const),
) {}
