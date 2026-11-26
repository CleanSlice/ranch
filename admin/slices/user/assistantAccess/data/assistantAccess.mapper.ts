import {
  ASSISTANT_ABILITY_STATES,
  ASSISTANT_LEVELS,
  type AssistantAbilityState,
  type AssistantLevel,
  type AssistantLevelOrCustom,
  type IAbility,
  type IAbilityArea,
  type IAssistantAccountData,
  type IAssistantCatalog,
  type IAssistantException,
  type IAssistantOverview,
  type IAssistantPick,
  type IAssistantResolved,
  type IAssistantRoleData,
  type IMyAbility,
  type IMyAssistantAccess,
  type ISetAssistantInput,
  type PersonRole,
} from '../domain/assistantAccess.types';

const ROLES = new Set<string>(['Owner', 'Admin', 'User']);

const record = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;

const strings = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && x !== '')
    : [];

const count = (raw: unknown): number =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;

const text = (raw: unknown): string => (typeof raw === 'string' ? raw : '');

const isLevel = (raw: unknown): raw is AssistantLevel =>
  (ASSISTANT_LEVELS as readonly unknown[]).includes(raw);

/**
 * Maps the assistant access API onto domain shapes; reads defensively.
 *
 * A level this console does not know reads as Basic and a missing switch as
 * off: when an answer cannot be read, showing less than the person has is the
 * safe way to be wrong on a page that hands out abilities.
 */
export class AssistantAccessMapper {
  toResolved(raw: unknown): IAssistantResolved | null {
    const o = record(raw);
    if (!o) return null;
    const level: AssistantLevelOrCustom =
      o.level === 'custom' ? 'custom' : isLevel(o.level) ? o.level : 'basic';
    return {
      enabled: o.enabled === true,
      level,
      matchesLevel: isLevel(o.matchesLevel) ? o.matchesLevel : null,
      source:
        o.source === 'owner' || o.source === 'account' ? o.source : 'role',
      offered: count(o.offered),
      available: count(o.available),
      version: typeof o.version === 'string' ? o.version : null,
    };
  }

  toPick(raw: unknown): IAssistantPick | null {
    const o = record(raw);
    return o ? { on: strings(o.on), new: strings(o.new) } : null;
  }

  toRole(raw: unknown): IAssistantRoleData | null {
    const resolved = this.toResolved(raw);
    const o = record(raw);
    if (!resolved || !o) return null;
    return { ...resolved, pick: this.toPick(o.pick), accounts: count(o.accounts) };
  }

  toAccount(raw: unknown): IAssistantAccountData | null {
    const resolved = this.toResolved(raw);
    const o = record(raw);
    if (!resolved || !o || typeof o.userId !== 'string') return null;
    return {
      ...resolved,
      userId: o.userId,
      role: this.toPersonRole(o.role),
      pick: this.toPick(o.pick),
      roleSetting: this.toResolved(o.roleSetting),
      editable: o.editable === true,
      ceiling: Array.isArray(o.ceiling) ? strings(o.ceiling) : null,
    };
  }

  toOverview(raw: unknown): IAssistantOverview | null {
    const o = record(raw);
    const roles = record(o?.roles);
    if (!o || !roles) return null;
    const admin = this.toRole(roles.Admin);
    const user = this.toRole(roles.User);
    if (!admin || !user) return null;
    const assistant = record(o.assistant);
    return {
      assistant:
        assistant && typeof assistant.id === 'string'
          ? { id: assistant.id, name: text(assistant.name) }
          : null,
      roles: { Admin: admin, User: user },
      exceptions: (Array.isArray(o.exceptions) ? o.exceptions : [])
        .map((item) => this.toException(item))
        .filter((item): item is IAssistantException => item !== null),
      notice: this.toNotice(o.notice),
    };
  }

  toMine(raw: unknown): IMyAssistantAccess | null {
    const o = record(raw);
    if (!o) return null;
    const level =
      o.level === 'owner' || o.level === 'custom' || isLevel(o.level)
        ? o.level
        : 'basic';
    return {
      enabled: o.enabled === true,
      level,
      matchesLevel: isLevel(o.matchesLevel) ? o.matchesLevel : null,
      areas: (Array.isArray(o.areas) ? o.areas : [])
        .map((item) => record(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .filter((item) => typeof item.key === 'string')
        .map((item) => ({
          key: item.key as string,
          title: text(item.title) || (item.key as string),
          offered: count(item.offered),
          available: count(item.available),
          abilities: this.toMyAbilities(item.abilities),
        })),
    };
  }

  /**
   * An area's abilities for the person's own card: theirs first, then the
   * ones good for agents they created, then what was left out. Within each
   * the server's order, which is by title. A state this console does not
   * know reads as not included: showing less is the safe way to be wrong.
   */
  private toMyAbilities(raw: unknown): IMyAbility[] {
    if (!Array.isArray(raw)) return [];
    const out: IMyAbility[] = [];
    for (const item of raw) {
      const o = record(item);
      if (!o || typeof o.name !== 'string' || !o.name) continue;
      const state = ASSISTANT_ABILITY_STATES.find((s) => s === o.state);
      out.push({
        name: o.name,
        title: text(o.title) || o.name,
        state: state ?? 'not_included',
      });
    }
    const rank = (state: AssistantAbilityState) =>
      ASSISTANT_ABILITY_STATES.indexOf(state);
    // Array.prototype.sort is stable: the received order survives in a group.
    return out.sort((a, b) => rank(a.state) - rank(b.state));
  }

  private toNotice(raw: unknown): { usersManagingAgents: number } | null {
    const o = record(raw);
    const n = count(o?.usersManagingAgents);
    return o && n > 0 ? { usersManagingAgents: n } : null;
  }

  toCatalog(raw: unknown): IAssistantCatalog | null {
    const o = record(raw);
    if (!o || !Array.isArray(o.areas)) return null;
    return {
      areas: o.areas
        .map((item) => this.toArea(item))
        .filter((item): item is IAbilityArea => item !== null)
        .sort((a, b) => a.order - b.order),
      alwaysOn: this.toAbilities(o.alwaysOn),
    };
  }

  /** Only what was asked for travels: what is left out stays as it is. */
  toSetDto(input: ISetAssistantInput) {
    return {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.on !== undefined ? { on: [...input.on] } : {}),
      ...(input.version ? { version: input.version } : {}),
    };
  }

  private toException(raw: unknown): IAssistantException | null {
    const o = record(raw);
    const resolved = this.toResolved(o?.resolved);
    if (!o || !resolved || typeof o.userId !== 'string') return null;
    return {
      userId: o.userId,
      name: text(o.name),
      email: text(o.email),
      role: this.toPersonRole(o.role),
      resolved,
      updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : null,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
      reducedByRole: o.reducedByRole === true,
    };
  }

  private toArea(raw: unknown): IAbilityArea | null {
    const o = record(raw);
    if (!o || typeof o.key !== 'string') return null;
    return {
      key: o.key,
      title: text(o.title) || o.key,
      order: count(o.order),
      abilities: this.toAbilities(o.abilities),
    };
  }

  private toAbilities(raw: unknown): IAbility[] {
    if (!Array.isArray(raw)) return [];
    const out: IAbility[] = [];
    for (const item of raw) {
      const o = record(item);
      if (!o || typeof o.name !== 'string' || !o.name) continue;
      out.push({
        name: o.name,
        title: text(o.title) || o.name,
        area: text(o.area),
        // Unreadable reads as the one that carries the warning mark.
        effect: o.effect === 'read' ? 'read' : 'write',
        destructive: o.destructive === true,
        // Unreadable reads as the Owner's: shown, never tickable.
        minRole: this.toPersonRole(o.minRole, 'Owner'),
        levels: Array.isArray(o.levels) ? o.levels.filter(isLevel) : [],
        ownAgentsOnly: o.ownAgentsOnly === true,
      });
    }
    return out;
  }

  private toPersonRole(raw: unknown, fallback: PersonRole = 'User'): PersonRole {
    return typeof raw === 'string' && ROLES.has(raw)
      ? (raw as PersonRole)
      : fallback;
  }
}
