import { PartialType } from '@nestjs/swagger';
import { CreateAgentDto } from './createAgent.dto';

export class UpdateAgentDto extends PartialType(CreateAgentDto) {}
