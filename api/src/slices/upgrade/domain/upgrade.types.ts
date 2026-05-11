export interface IUpgradeEligibility {
  eligible: boolean;
  reason?: string;
  currentVersion: string;
  branch?: string;
  dirty?: boolean;
}

export interface IUpgradeStage {
  name: string;
  durationMs: number;
  output?: string;
}

export interface IUpgradeResult {
  versionBefore: string;
  versionAfter: string;
  stages: IUpgradeStage[];
}
