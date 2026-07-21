import type { IAgentData } from '#agent/domain';
import type { ITemplateData } from '#template/domain';
import type { IRancherStatus } from '../domain/rancher.types';

/**
 * Maps the Rancher status API onto the domain shape. The nested `template` /
 * `admin` are the same read-only structures the agent/template APIs return, so
 * they're presence-validated casts rather than re-mapped here.
 */
export class RancherMapper {
  toStatus(raw: unknown): IRancherStatus | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    return {
      hasLlm: o.hasLlm === true,
      hasS3: o.hasS3 === true,
      template: this.toTemplate(o.template),
      admin:
        o.admin && typeof o.admin === 'object' ? (o.admin as IAgentData) : null,
    };
  }

  toTemplate(raw: unknown): ITemplateData | null {
    return raw && typeof raw === 'object' ? (raw as ITemplateData) : null;
  }
}
