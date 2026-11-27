import { Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '#/user/auth/guards';
import { IUserGateway, UserRoleTypes } from '#/user/user/domain';
import { AssistantSettingService } from './domain/assistantSetting.service';

export class AssistantSettingDriftDto {
  @ApiProperty({ example: 'integrations' }) group: string;
  @ApiProperty({ example: 's3_bucket' }) name: string;
  @ApiProperty({
    enum: ['changed', 'added', 'removed'],
    description:
      'What happened to the live setting since the Owner approved it. Never the values.',
  })
  change: string;
  @ApiProperty({ type: String, nullable: true }) changedById: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The account that made the change, when it still exists.',
  })
  changedByName: string | null;
  @ApiProperty() changedAt: Date;
}

export class AssistantSettingsDto {
  @ApiProperty({
    type: [AssistantSettingDriftDto],
    description:
      'Settings whose live value differs from the one the Ranch assistant is served. Empty when the assistant runs on the live settings.',
  })
  drift: AssistantSettingDriftDto[];
}

export class AssistantSettingsAppliedDto {
  @ApiProperty({
    type: [String],
    description: 'The settings that moved, as `group.name`.',
  })
  applied: string[];
}

/**
 * The settings the Ranch assistant is served, for the Owner (CLEAN-271): what
 * differs from the live ones, and the one action that makes the live ones
 * the approved ones. Both are the Owner's alone: an Admin changes settings
 * for every other agent and is told on the Settings page that the assistant
 * keeps the approved values.
 */
@ApiTags('rancher')
@ApiBearerAuth()
@Controller('rancher/settings')
@Roles(UserRoleTypes.Owner)
export class AssistantSettingController {
  constructor(
    private readonly service: AssistantSettingService,
    private readonly users: IUserGateway,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'getAssistantSettings',
    summary:
      'Which settings differ, live, from the values the Ranch assistant is deployed from (the ones the Owner approved): the key, what happened (changed, added, removed), who and when. Never a value. Owner only.',
  })
  @ApiOkResponse({ type: AssistantSettingsDto })
  async read(): Promise<AssistantSettingsDto> {
    const drift = await this.service.drift();
    const names = new Map<string, string | null>();
    for (const id of new Set(drift.map((row) => row.changedById))) {
      if (!id) continue;
      const user = await this.users.findById(id).catch(() => null);
      names.set(id, user ? user.name || user.email : null);
    }
    return {
      drift: drift.map((row) => ({
        ...row,
        changedByName: row.changedById
          ? (names.get(row.changedById) ?? null)
          : null,
      })),
    };
  }

  @Post('apply')
  @ApiOperation({
    operationId: 'applySettingsToAssistant',
    summary:
      'Make the live settings the approved ones: the Ranch assistant is served them from its next restart. Answers the keys that moved. Owner only.',
  })
  @ApiOkResponse({ type: AssistantSettingsAppliedDto })
  async apply(): Promise<AssistantSettingsAppliedDto> {
    const moved = await this.service.applyCurrent();
    return { applied: moved.map((row) => `${row.group}.${row.name}`) };
  }
}
