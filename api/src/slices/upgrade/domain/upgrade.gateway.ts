import { IUpgradeEligibility, IUpgradeResult } from './upgrade.types';

export abstract class IUpgradeGateway {
  abstract checkEligibility(): Promise<IUpgradeEligibility>;
  abstract performUpgrade(): Promise<IUpgradeResult>;
}
