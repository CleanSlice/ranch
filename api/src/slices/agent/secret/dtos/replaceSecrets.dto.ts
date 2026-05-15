import { ApiProperty } from '@nestjs/swagger';
import {
  IsObject,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

// Walks the object and rejects anything that isn't a flat string→string map.
// class-validator has no built-in Record<string,string> check; nested-object
// DTOs don't fit because the keys are dynamic.
function IsStringRecord(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isStringRecord',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate(value: unknown) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return false;
          }
          for (const v of Object.values(value as Record<string, unknown>)) {
            if (typeof v !== 'string') return false;
          }
          return true;
        },
        defaultMessage() {
          return 'store must be a flat object with string values';
        },
      },
    });
  };
}

export class ReplaceSecretsDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { 'instagram:password': 'p@ss', 'paypal:api_token': 'sk-...' },
    description:
      "Full secret store for the agent — replaces everything. Pass {} to clear. Mirrors AWS Secrets Manager's plaintext-edit semantics.",
  })
  @IsObject()
  @IsStringRecord()
  store!: Record<string, string>;
}
