import { PartialType } from '@nestjs/swagger';
import { CreateSkillDto } from './createSkill.dto';

export class UpdateSkillDto extends PartialType(CreateSkillDto) {}
