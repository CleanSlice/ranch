import type { IAgentData } from '#agent/domain';
import type { ITemplateData } from '#template/domain';

// Domain types for the Rancher bootstrap status.

export interface IRancherStatus {
  hasLlm: boolean;
  hasS3: boolean;
  template: ITemplateData | null;
  admin: IAgentData | null;
}
