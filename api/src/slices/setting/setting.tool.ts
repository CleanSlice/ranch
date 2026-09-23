import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  CONFIRM_SENTENCE,
  callerIsOperator,
  confirmed,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAuthTokenPayload } from '#/user/auth/domain';
import {
  IInfraConfigGateway,
  ISettingGateway,
  findSettingDefinition,
  nearestSettingDefinition,
  settingKey,
  type ISettingData,
} from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * Reading and resetting one setting from the chat (CLEAN-109). Mirrors
 * `GET settings/:group/:name` and `DELETE settings/:group/:name` of
 * `SettingController`; listing and upserting stay in `rancher.tool.ts`.
 *
 * A setting is a free-form `group.name` row, so "not found" here usually
 * means a misspelt key rather than an empty value. Both tools therefore
 * answer with the nearest catalogued key (`domain/settingCatalog.ts`) so the
 * model corrects itself instead of inventing a row the platform never reads.
 *
 * Operator-only: platform settings are the console's Settings section, and
 * a plain agent has no business reading the AWS keys or the bridle secret
 * that live there.
 */
@Injectable()
export class SettingTool implements IConditionallyListedTool {
  private readonly logger = new Logger(SettingTool.name);

  constructor(
    private readonly settings: ISettingGateway,
    private readonly infraConfig: IInfraConfigGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_setting',
    topic: ToolTopics.Settings,
    title: 'Show one setting',
    template: 'What is «group».«name» set to?',
    description:
      'Read a single platform setting by group and name: its value, value ' +
      'type and when it was last changed, plus what the key means when it is ' +
      'a known one. A secret (API key, token, password) is reported as set or ' +
      'empty, never shown. An unknown key names the closest catalogued key so ' +
      'you can retry — list_settings shows every row that exists.',
    parameters: z.object({
      group: z.string().describe('Setting group, e.g. integrations, auth'),
      name: z
        .string()
        .describe('Setting name inside the group, e.g. s3_bucket'),
    }),
  })
  async getSetting(
    { group, name }: { group: string; name: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const setting = await this.settings.findByKey(group, name);
    if (!setting) return ok(notFound(group, name));
    const definition = findSettingDefinition(group, name);
    return ok({
      ...presentable(setting, Boolean(definition?.secret)),
      ...(definition && {
        meaning: definition.description,
        restartRequired: definition.restartRequired,
      }),
    });
  }

  @Tool({
    name: 'delete_setting',
    topic: ToolTopics.Settings,
    title: 'Delete a setting',
    template: 'Reset «group».«name» to its default',
    destructive: true,
    description:
      'Remove a platform setting row, so the platform falls back to its ' +
      'built-in default (or the env value, for the infrastructure group). ' +
      'There is no undo — the old value is gone; set it again with ' +
      'upsert_setting if needed. For keys agents receive at deploy time the ' +
      'change reaches a running agent only after restart_agent. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      group: z.string(),
      name: z.string(),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteSetting(
    args: { group: string; name: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { group, name } = args;
    const existing = await this.settings.findByKey(group, name);
    if (!existing) return ok(notFound(group, name));
    const refusal = confirmed(
      args,
      `reset «${settingKey(group, name)}» to its default`,
    );
    if (refusal) return refusal;

    await this.settings.delete(group, name);
    // The controller drops the infra cache on this group so the next read
    // sees the env/default value instead of the row that no longer exists.
    if (group === 'infrastructure') this.infraConfig.invalidate();
    this.logger.log(`Setting deleted through MCP: ${settingKey(group, name)}`);

    const definition = findSettingDefinition(group, name);
    return ok({
      ok: true,
      group,
      name,
      message:
        `«${settingKey(group, name)}» removed — the platform now uses its default.` +
        (definition?.restartRequired
          ? ' Running agents keep the old value until they restart — offer restart_agent.'
          : ''),
    });
  }
}

/** The row as a tool may show it: a secret value is reported, not echoed. */
function presentable(
  setting: ISettingData,
  secret: boolean,
): Record<string, unknown> {
  const { value, ...rest } = setting;
  if (!secret) return { ...rest, value };
  const isSet = typeof value === 'string' ? value.length > 0 : value != null;
  return { ...rest, value: isSet ? '(secret — set)' : '(secret — empty)' };
}

function notFound(group: string, name: string): { error: string } {
  const key = settingKey(group, name);
  const near = nearestSettingDefinition(group, name);
  const hint = near
    ? ` Did you mean «${settingKey(near.group, near.name)}» (${near.description})?`
    : '';
  return {
    error: `Setting «${key}» is not set.${hint} Call list_settings to see every row that exists.`,
  };
}
