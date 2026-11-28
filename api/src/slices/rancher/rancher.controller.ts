import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { heldRoles, rolesAdmit } from '#/user/auth/guards/roles.guard';
import { assistantSettingDrift } from '#/setting/domain';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { accessCallerOf } from '#/user/agentAccess/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { RancherService } from './domain/rancher.service';
import {
  rancherStatusFor,
  type IRancherStatusView,
} from './domain/rancherStatusView';

@ApiTags('rancher')
@ApiBearerAuth()
@Controller('rancher')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RancherController {
  constructor(
    private rancherService: RancherService,
    private access: AgentAccessService,
    private permission: AgentPermissionService,
  ) {}

  @Get('status')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Stepper state for the Rancher setup wizard: do we have an LLM, storage, the special template, and an admin agent (`hasAdmin`)? `admin` is the Ranch admin agent as the caller may read it: null for a caller whose access lists do not reach it, without configuration for a caller who may not manage it (an Admin), whole for the Owner (CLEAN-231).',
  })
  async status(
    @Req() req?: Request & { user?: IAuthTokenPayload },
  ): Promise<IRancherStatusView> {
    const status = await this.rancherService.getStatus();
    const agent = status.admin;
    // The agent is addressed by its flag here, not by an id, so neither
    // route marker sees it: the lists and the manage rule are asked by hand,
    // as GET /agents/admin/current does.
    let reaches = false;
    let manages = false;
    if (agent) {
      reaches = await this.access.reaches(accessCallerOf(req), agent.id);
      manages =
        reaches &&
        (await this.permission.canManage(
          AgentPermissionService.callerOfBearer(req?.user),
          agent,
        ));
    }
    const view = rancherStatusFor(status, { reaches, manages });
    // For the Owner only: the settings whose live value is not the one the
    // assistant is deployed from (CLEAN-271). Keys, never values.
    if (!rolesAdmit([UserRoleTypes.Owner], heldRoles(req?.user))) return view;
    return { ...view, settingsDrift: await assistantSettingDrift() };
  }

  // Owner only since CLEAN-271: this creates the template the Ranch
  // assistant is made from and seeds its instructions. What the assistant is
  // built from is the Owner's, before the assistant exists as much as after.
  @Post('template')
  @Roles(UserRoleTypes.Owner)
  @ApiOperation({
    summary:
      'Create the special Rancher template (idempotent). Returns the existing one if already created. Owner only: it is what the Ranch assistant is built from (CLEAN-271).',
  })
  ensureTemplate() {
    return this.rancherService.ensureTemplate();
  }
}
