import type { IAgentData } from '#agent/domain';
import type { ITemplateData } from '#template/domain';
import type {
  IAssistantSettingDrift,
  IRancherStatus,
} from '../domain/rancher.types';

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

  /** `GET /rancher/settings`: keys, what happened, who and when. */
  toDrift(raw: unknown): IAssistantSettingDrift[] {
    const rows = (raw as { drift?: unknown } | null)?.drift;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      const o = row as Record<string, unknown> | null;
      if (!o || typeof o.group !== 'string' || typeof o.name !== 'string') {
        return [];
      }
      return [
        {
          group: o.group,
          name: o.name,
          change: typeof o.change === 'string' ? o.change : 'changed',
          changedByName:
            typeof o.changedByName === 'string' ? o.changedByName : null,
          changedAt: typeof o.changedAt === 'string' ? o.changedAt : '',
          version: typeof o.version === 'string' ? o.version : '',
        },
      ];
    });
  }

  toApplied(raw: unknown): string[] {
    const keys = (raw as { applied?: unknown } | null)?.applied;
    return Array.isArray(keys)
      ? keys.filter((key): key is string => typeof key === 'string')
      : [];
  }

  toTemplate(raw: unknown): ITemplateData | null {
    return raw && typeof raw === 'object' ? (raw as ITemplateData) : null;
  }
}
