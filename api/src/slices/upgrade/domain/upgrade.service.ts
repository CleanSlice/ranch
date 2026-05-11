import { Injectable, Logger } from '@nestjs/common';
import { IUpgradeGateway } from './upgrade.gateway';
import { IUpgradeEligibility, IUpgradeResult } from './upgrade.types';

@Injectable()
export class UpgradeService {
  private readonly logger = new Logger(UpgradeService.name);

  constructor(private gateway: IUpgradeGateway) {}

  getStatus(): Promise<IUpgradeEligibility> {
    return this.gateway.checkEligibility();
  }

  async run(): Promise<IUpgradeResult> {
    this.logger.log('Starting in-place Ranch upgrade');
    const result = await this.gateway.performUpgrade();
    this.logger.log(
      `Upgrade complete: ${result.versionBefore} → ${result.versionAfter}`,
    );
    return result;
  }
}
