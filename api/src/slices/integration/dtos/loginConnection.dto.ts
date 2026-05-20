import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for `POST /integrations/accounts/:id/login`. The agent
 * forwards `helpUrl` (or paraphrases `instructions`) to the end user.
 * The user opens the Ranch Cookies extension on `siteUrl`, logs in, and
 * sends cookies — the row flips to "connected" once the extension's
 * import-state POST lands.
 */
export class LoginInstructionDto {
  @ApiProperty({ description: 'IntegrationAccount.id these instructions are for.' })
  accountId: string;

  @ApiProperty({
    description:
      'Direct link to the service login page (catalogue.loginUrl) — the user opens this in their normal browser.',
  })
  siteUrl: string;

  @ApiProperty({
    description:
      'Admin-UI route that walks the user through the connect flow (install extension if needed, log in on siteUrl, send cookies).',
  })
  helpUrl: string;

  @ApiProperty({
    description:
      'Plain-text instructions the agent can paraphrase for chat channels where helpUrl is not directly clickable. Three short lines.',
  })
  instructions: string;
}
