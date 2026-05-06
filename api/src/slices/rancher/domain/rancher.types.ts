import type { IAgentData } from '#/agent/agent/domain';
import type { ITemplateData } from '#/agent/template/domain';

export const RANCHER_TEMPLATE_ID = 'template-rancher';
export const RANCHER_TEMPLATE_NAME = 'Rancher';
export const RANCHER_AGENT_NAME = 'Rancher';

export const RANCHER_TEMPLATE_DEFAULTS = {
  description:
    'Special template for the Ranch admin agent (Rancher). Auto-generated and managed by the Rancher service.',
  image: 'ghcr.io/cleanslice/runtime:latest',
  defaultResources: { cpu: '500m', memory: '512Mi' },
} as const;

export interface IRancherStatus {
  hasLlm: boolean;
  hasS3: boolean;
  template: ITemplateData | null;
  admin: IAgentData | null;
}
