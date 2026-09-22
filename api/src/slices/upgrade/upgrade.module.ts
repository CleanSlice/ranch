import { Module, forwardRef } from '@nestjs/common';
import { UpgradeController } from './upgrade.controller';
import { IUpgradeGateway } from './domain/upgrade.gateway';
import { UpgradeService } from './domain/upgrade.service';
import { UpgradeGateway } from './data/upgrade.gateway';
import { UpgradeTool } from './upgrade.tool';
import { AuthModule } from '#/user/auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [UpgradeController],
  providers: [
    UpgradeService,
    // MCP tools: get_upgrade_status / run_upgrade, operator-only (CLEAN-109).
    UpgradeTool,
    {
      provide: IUpgradeGateway,
      useClass: UpgradeGateway,
    },
  ],
  exports: [UpgradeService],
})
export class UpgradeModule {}
