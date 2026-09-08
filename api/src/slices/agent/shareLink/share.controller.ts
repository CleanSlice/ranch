import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ShareLinkService } from './domain';
import { ShareResolveRequestDto, ShareResolvedDto } from './dtos';

/**
 * Visitor side of agent sharing (CLEAN-66). Unguarded on purpose: whoever
 * holds the link is the credential, and a share visitor has no account. The
 * token is the only thing that grants anything, so it travels in the body
 * (never a query string, which lands in access logs and Referer headers).
 */
@ApiTags('share')
@Controller('share')
export class ShareController {
  constructor(private readonly shareLinks: ShareLinkService) {}

  @Post('resolve')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'resolveShareLink',
    summary:
      'Exchange a share token for the little the visitor may know about the ' +
      'agent behind it: id, name and status. Nothing else about the agent is ' +
      'exposed. An unknown token and a revoked token answer with the exact ' +
      "same 404 body ({ code: 'SHARE_LINK_NOT_FOUND' }), so a link that was " +
      'turned off is indistinguishable from one that never existed. A ' +
      'malformed token is rejected as 400 before any lookup happens.',
  })
  @ApiOkResponse({ type: ShareResolvedDto })
  @ApiNotFoundResponse({
    description:
      'No usable link behind this token — unknown, revoked, or pointing at ' +
      "an agent that no longer exists. One identical body (`{ code: " +
      "'SHARE_LINK_NOT_FOUND' }`) for all three, so a visitor cannot tell " +
      'a link that was turned off from one that never existed (FR-013).',
  })
  @ApiBadRequestResponse({
    description:
      'The token is missing or does not look like a share token; rejected by ' +
      'validation before any lookup happens.',
  })
  async resolve(
    @Body() dto: ShareResolveRequestDto,
  ): Promise<ShareResolvedDto> {
    const resolved = await this.shareLinks.resolveForVisitor(dto.token);
    return {
      agentId: resolved.agentId,
      agentName: resolved.agentName,
      agentStatus: resolved.agentStatus,
    };
  }
}
