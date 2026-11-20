import type {
  AssistantLevelTypes,
  IAssistantAreaCount,
  IMyAssistantAccess,
} from '../domain/assistantAccess.types';

const LEVELS: readonly AssistantLevelTypes[] = [
  'owner',
  'basic',
  'standard',
  'full',
  'custom',
];

const count = (raw: unknown): number =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;

/**
 * Maps `GET /me/assistant-access` onto the domain shape; reads defensively.
 * An answer that cannot be read is no answer: the badge is then not drawn,
 * which is better than drawing a level the person does not have.
 */
export class AssistantAccessMapper {
  toMine(raw: unknown): IMyAssistantAccess | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const level = LEVELS.find((l) => l === o.level);
    if (!level || typeof o.enabled !== 'boolean') return null;
    return {
      enabled: o.enabled,
      level,
      areas: (Array.isArray(o.areas) ? o.areas : []).flatMap((item) =>
        this.toArea(item),
      ),
    };
  }

  private toArea(raw: unknown): IAssistantAreaCount[] {
    if (!raw || typeof raw !== 'object') return [];
    const o = raw as Record<string, unknown>;
    if (typeof o.key !== 'string' || !o.key) return [];
    return [
      {
        key: o.key,
        title: typeof o.title === 'string' && o.title ? o.title : o.key,
        offered: count(o.offered),
        available: count(o.available),
      },
    ];
  }
}
