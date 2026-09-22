import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import {
  CONFIRM_SENTENCE,
  callerIsOperator,
  confirmed,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { UpgradeService } from './domain/upgrade.service';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * Ranch's own upgrade, from the chat (CLEAN-109). Mirrors `UpgradeController`:
 * status is a read, running it is gated by the same eligibility check and,
 * because it replaces the running code, by the person's confirmation.
 */
@Injectable()
export class UpgradeTool implements IConditionallyListedTool {
  private readonly logger = new Logger(UpgradeTool.name);

  constructor(private readonly upgrade: UpgradeService) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_upgrade_status',
    topic: ToolTopics.Platform,
    title: 'Ranch upgrade status',
    template: 'Is a Ranch upgrade available?',
    description:
      'Whether this Ranch checkout can be upgraded in place (clean git tree, on main, .git present, not in deployed mode) and, when it cannot, why. Read-only.',
    parameters: z.object({}),
  })
  async status(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    return ok(await this.upgrade.getStatus());
  }

  @Tool({
    name: 'run_upgrade',
    topic: ToolTopics.Platform,
    title: 'Upgrade Ranch',
    template: 'Upgrade Ranch to the latest version',
    destructive: true,
    description:
      'Pull the latest Ranch from main, install dependencies and run migrations. The dev watchers pick the new code up, so the API may restart mid-call and the chat may drop for a moment. Refused when get_upgrade_status says not eligible. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async run(
    args: { confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const eligibility = await this.upgrade.getStatus();
    if (!eligibility.eligible) {
      return err(
        `Upgrade not allowed: ${eligibility.reason ?? 'this checkout is not eligible'}. Fix that first, then call get_upgrade_status again.`,
      );
    }
    const refusal = confirmed(
      args,
      'upgrade Ranch in place (pull main, install, migrate) and restart the API',
    );
    if (refusal) return refusal;
    this.logger.log('Upgrade started through MCP');
    return ok(await this.upgrade.run());
  }
}
