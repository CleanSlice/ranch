import { PartialType } from '@nestjs/swagger';
import { CreateLlmCredentialDto } from './createLlmCredential.dto';

export class UpdateLlmCredentialDto extends PartialType(
  CreateLlmCredentialDto,
) {}
