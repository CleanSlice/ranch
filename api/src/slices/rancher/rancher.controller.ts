import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RancherService } from './domain/rancher.service';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';

@ApiTags('rancher')
@ApiBearerAuth()
@Controller('rancher')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RancherController {
  constructor(private rancherService: RancherService) {}

  @Get('status')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Stepper state for the Rancher setup wizard: do we have an LLM, the special template, and an admin agent?',
  })
  status() {
    return this.rancherService.getStatus();
  }

  @Post('template')
  @Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
  @ApiOperation({
    summary:
      'Create the special Rancher template (idempotent). Returns the existing one if already created.',
  })
  ensureTemplate() {
    return this.rancherService.ensureTemplate();
  }
}
