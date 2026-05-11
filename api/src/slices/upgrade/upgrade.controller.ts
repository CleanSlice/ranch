import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, Roles, RolesGuard } from '#/user/auth/guards';
import { UserRoleTypes } from '#/user/user/domain';
import { UpgradeService } from './domain/upgrade.service';
import { UpgradeResultDto, UpgradeStatusDto } from './dtos';

@ApiTags('upgrade')
@ApiBearerAuth()
@Controller('upgrade')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRoleTypes.Owner, UserRoleTypes.Admin)
export class UpgradeController {
  constructor(private upgrade: UpgradeService) {}

  @Get('status')
  @ApiOperation({
    summary:
      'Whether the local checkout can be upgraded in place (clean tree, on main, .git present, not in deployed mode).',
  })
  status(): Promise<UpgradeStatusDto> {
    return this.upgrade.getStatus();
  }

  @Post()
  @ApiOperation({
    summary:
      "Pull latest Ranch from main, bun install, prisma migrate deploy. nest's --watch and Nuxt HMR pick up the new code automatically. Response may not return cleanly if the watcher restarts mid-call — the client should reload after a short delay.",
  })
  async run(): Promise<UpgradeResultDto> {
    const eligibility = await this.upgrade.getStatus();
    if (!eligibility.eligible) {
      throw new ForbiddenException(eligibility.reason ?? 'Upgrade not allowed');
    }
    return this.upgrade.run();
  }
}
