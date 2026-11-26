import {
  ASSISTANT_ABILITY_STATES,
  type AssistantAbilityStateTypes,
  type AssistantLevelTypes,
  type IAssistantAbility,
  type IAssistantAreaCount,
  type IMyAssistantAccess,
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
        abilities: this.toAbilities(o.abilities),
      },
    ];
  }

  /**
   * An area's abilities: theirs first, then the ones good for agents they
   * created, then what was left out. Within each the server's order, which
   * is by title. A state this console does not know reads as not included:
   * showing less than the person has is the safe way to be wrong.
   */
  private toAbilities(raw: unknown): IAssistantAbility[] {
    if (!Array.isArray(raw)) return [];
    const out: IAssistantAbility[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (typeof o.name !== 'string' || !o.name) continue;
      const state = ASSISTANT_ABILITY_STATES.find((s) => s === o.state);
      out.push({
        name: o.name,
        title: typeof o.title === 'string' && o.title ? o.title : o.name,
        state: state ?? 'not_included',
      });
    }
    const rank = (state: AssistantAbilityStateTypes) =>
      ASSISTANT_ABILITY_STATES.indexOf(state);
    // Array.prototype.sort is stable: the received order survives in a group.
    return out.sort((a, b) => rank(a.state) - rank(b.state));
  }
}
