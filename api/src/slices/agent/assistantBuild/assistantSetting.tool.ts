import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  CONFIRM_SENTENCE,
  callerIsOwner,
  confirmed,
  ok,
  requireOwner,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import {
  AssistantSettingService,
  SETTINGS_CHANGED_TEXT,
  driftToken,
} from './domain/assistantSetting.service';

/**
 * The settings the Ranch assistant is deployed from, from the chat
 * (CLEAN-271). Mirrors `GET /rancher/settings` and
 * `POST /rancher/settings/apply`, both `@Roles(Owner)`.
 *
 * The assistant runs on the values the Owner approved. A setting somebody
 * else changed keeps its approved value for the assistant until the Owner
 * applies it; these two tools are how the Owner sees that and does it.
 * Neither ever shows a value: a key, what happened to it, who and when.
 */
@ToolAudience('owner')
@Injectable()
export class AssistantSettingTool implements IConditionallyListedTool {
  private readonly logger = new Logger(AssistantSettingTool.name);

  constructor(private readonly service: AssistantSettingService) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOwner(httpRequest));
  }

  @Tool({
    name: 'get_assistant_settings',
    topic: ToolTopics.Settings,
    effect: 'read',
    title: 'Settings the assistant runs on',
    template: 'Do the assistant’s settings differ from the current ones?',
    description:
      'Which platform settings differ, live, from the values the Ranch ' +
      'assistant is deployed from. The assistant runs on the settings the ' +
      'Owner approved: when somebody else changes a setting, other agents ' +
      'get the new value and the assistant keeps the old one until the ' +
      'Owner applies it. Returns each such setting as group.name with what ' +
      'happened (changed, added, removed), who did it and when; never a ' +
      'value. An empty list means the assistant runs on the current ' +
      'settings. The result carries `applyToken`, which names this exact ' +
      'list: apply_settings_to_assistant takes it back.',
    parameters: z.object({}),
  })
  async getAssistantSettings(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOwner(httpRequest);
    const drift = await this.service.drift();
    return ok({
      drift: drift.map((row) => ({
        setting: `${row.group}.${row.name}`,
        change: row.change,
        changedById: row.changedById,
        changedAt: row.changedAt,
      })),
      ...(drift.length > 0 ? { applyToken: driftToken(drift) } : {}),
      ...(drift.length === 0
        ? { message: 'The assistant runs on the current settings.' }
        : {
            message:
              `${drift.length} setting(s) were changed by somebody else: ` +
              'the assistant keeps the approved values until ' +
              'apply_settings_to_assistant.',
          }),
    });
  }

  @Tool({
    name: 'apply_settings_to_assistant',
    topic: ToolTopics.Settings,
    effect: 'write',
    title: 'Apply current settings to the assistant',
    template: 'Apply the settings of the list «apply token» to the assistant',
    destructive: true,
    description:
      'Make the current platform settings the ones the Ranch assistant is ' +
      'deployed from. Do this only after checking what changed with ' +
      'get_assistant_settings: these settings decide where the assistant ' +
      'loads its files from and where its token is sent. It takes effect at ' +
      'the assistant’s next restart (restart_agent). Returns the settings ' +
      'that moved. Pass the `applyToken` get_assistant_settings returned ' +
      'with the list the person was shown: when a setting changed since, ' +
      'the call is refused and nothing is applied, so show the new list ' +
      'and ask again. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      applyToken: z
        .string()
        .describe(
          'The applyToken of the list the person was shown (get_assistant_settings).',
        ),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async applySettingsToAssistant(
    args: { applyToken?: string; confirm?: boolean },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOwner(httpRequest);
    const drift = await this.service.drift();
    if (drift.length === 0) {
      return ok({
        applied: [],
        message:
          'Nothing to apply: the assistant runs on the current settings.',
      });
    }
    // The confirmation is for the list the person was shown, not for
    // whatever the list is by the time they answer.
    if (args.applyToken !== driftToken(drift)) {
      return ok({
        error: SETTINGS_CHANGED_TEXT,
        reason: 'settings_changed',
        drift: drift.map((row) => ({
          setting: `${row.group}.${row.name}`,
          change: row.change,
          changedById: row.changedById,
          changedAt: row.changedAt,
        })),
        applyToken: driftToken(drift),
      });
    }
    const keys = drift.map((row) => `${row.group}.${row.name}`);
    const refusal = confirmed(
      args,
      `make the current value of ${keys.join(', ')} the one the assistant is deployed from`,
    );
    if (refusal) return refusal;
    // `applyExact` checks the list once more, in the transaction that
    // moves it: a change that lands after the comparison above is refused.
    const moved = await this.service.applyExact(drift);
    this.logger.log(
      `Current settings applied to the Ranch assistant through MCP: ${moved.length} key(s)`,
    );
    return ok({
      applied: moved.map((row) => `${row.group}.${row.name}`),
      message:
        'Applied. The assistant is served these values from its next ' +
        'restart: offer restart_agent.',
    });
  }
}
