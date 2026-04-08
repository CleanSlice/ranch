import { PartialType } from '@nestjs/swagger';
import { CreateTemplateDto } from './createTemplate.dto';

export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {}
