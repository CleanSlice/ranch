import { ApiProperty } from '@nestjs/swagger';

export class ResolvedSecretsDto {
  @ApiProperty({
    description:
      'Map of env-var name → secret value, ready for the runtime to merge into an agent process env. Empty object if the user has no matching secret-mechanism integrations.',
    additionalProperties: { type: 'string' },
    example: { OPENAI_API_KEY: 'sk-…', GITHUB_TOKEN: 'ghp_…' },
  })
  env: Record<string, string>;
}
