import { Injectable, Logger } from '@nestjs/common';
import { McpRegistryService } from '#/mcp/services/mcp-registry.service';
import { TOOL_TOPIC_INFO, type ToolTopic } from '#/mcp/decorators/topics';
import { isToolAudience } from '#/mcp/decorators';
import { IAgentGateway } from '#/agent/agent/domain';
import { IUserGateway } from '#/user/user/domain';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import type { ICallerParty } from '#/user/auth/domain/auth.types';
import { IAssistantAccessGateway } from './assistantAccess.gateway';
import {
  ASSISTANT_LEVELS,
  ASSISTANT_LEVEL_SUMMARIES,
  AssistantLevel,
  IAbility,
  abilityOf,
  isAssistantLevel,
  levelSet,
  levelsOf,
  withinCeiling,
} from './assistantLevels';
import {
  ASSISTANT_ACCESS_REFUSALS,
  ASSISTANT_ROLE_DEFAULTS,
  AssistantAccessError,
  AssistantAccessErrorCodes,
  AssistantLevelOrCustom,
  AssistantRole,
  IAssistantCustom,
  IAssistantEditor,
  IAssistantGrant,
  IAssistantPick,
  IAssistantResolved,
  IAssistantSettingData,
  IAssistantSettingInput,
  isAssistantRole,
} from './assistantAccess.types';

/** A setting as it applies, before it is counted for a view. */
interface IEffective {
  enabled: boolean;
  level: AssistantLevelOrCustom;
  custom: IAssistantCustom | null;
  source: 'role' | 'account';
  updatedAt: Date | null;
}

export interface IAssistantAreaCount {
  key: ToolTopic;
  title: string;
  offered: number;
  available: number;
}

export interface IAssistantLevelInfo {
  key: AssistantLevel;
  title: string;
  summary: string;
  areas: IAssistantAreaCount[];
}

export interface IAssistantRoleView extends IAssistantResolved {
  /** The stored pick, when the level is custom. */
  pick: IAssistantPick | null;
}

export interface IAssistantAccountView extends IAssistantRoleView {
  userId: string;
  role: UserRoleTypes;
  /** What the account would get without its own setting. */
  roleSetting: IAssistantResolved | null;
  /** Whether the one asking may change it. */
  editable: boolean;
  /** For an Admin editor: the names they may hand out. null ⇒ no such limit. */
  ceiling: string[] | null;
}

export interface IAssistantException {
  userId: string;
  name: string;
  email: string;
  role: UserRoleTypes;
  resolved: IAssistantResolved;
  updatedBy: string | null;
  updatedAt: Date | null;
  /** The pick holds abilities the account's present role cannot have. */
  reducedByRole: boolean;
}

export interface IAssistantOverview {
  assistant: { id: string; name: string } | null;
  roles: Record<AssistantRole, IAssistantRoleView & { accounts: number }>;
  exceptions: IAssistantException[];
}

export interface IAssistantCatalogAbility {
  name: string;
  title: string;
  area: ToolTopic;
  effect: 'read' | 'write';
  destructive: boolean;
  minRole: UserRoleTypes;
  levels: AssistantLevel[];
}

export interface IAssistantCatalogArea {
  key: ToolTopic;
  title: string;
  order: number;
  abilities: IAssistantCatalogAbility[];
}

export interface IAssistantCatalog {
  areas: IAssistantCatalogArea[];
  alwaysOn: IAssistantCatalogAbility[];
}

export interface IAssistantMine {
  enabled: boolean;
  level: AssistantLevelOrCustom | 'owner';
  matchesLevel: AssistantLevel | null;
  areas: IAssistantAreaCount[];
  /** What the person's role has and their setting leaves out. */
  leftOut: { name: string; title: string; area: ToolTopic }[];
}

const LEVEL_TITLES: Record<AssistantLevel, string> = {
  basic: 'Basic',
  standard: 'Standard',
  full: 'Full',
};

const isOwnerEditor = (editor: IAssistantEditor): boolean =>
  editor.kind === 'trusted' || editor.role === UserRoleTypes.Owner;

const versionOf = (at: Date | null | undefined): string | null =>
  at ? at.toISOString() : null;

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Who has the Ranch assistant, and what it offers them (CLEAN-240).
 *
 *   setting(person) = the account's own row
 *                  ?? the row of the person's role
 *                  ?? the default of that role (Admin: on, full; User: on, basic)
 *
 *   offered(person) = the names the setting's level or custom pick holds,
 *                     cut down to what the person's role can do at all
 *
 * The Owner, a trusted party and anybody who is not a signed-in Admin or User
 * have no setting: the Owner always has everything, and the rest are decided
 * elsewhere (specs/032). A setting can only take away: the role's ceiling is
 * applied by the tool catalogue before this is asked, and again here, so a
 * pick saved for an account that was an Admin gives a User nothing extra.
 *
 * Settings are read from the database on every call, two rows by primary
 * key, no cache: a change applies to the person's next message (FR-012), and
 * the API runs more than one copy.
 */
@Injectable()
export class AssistantAccessService {
  private readonly logger = new Logger(AssistantAccessService.name);

  constructor(
    private readonly gateway: IAssistantAccessGateway,
    private readonly users: IUserGateway,
    private readonly agents: IAgentGateway,
    private readonly registry: McpRegistryService,
  ) {}

  // ------------------------------------------------------------ the catalogue

  /** Every tool as the settings see it. Read from the registry each time: it
   *  is a list in memory, and a spec swaps it. */
  abilities(): IAbility[] {
    return this.registry
      .getTools()
      .filter((tool) => isToolAudience(tool.audience))
      .map((tool) =>
        abilityOf({ metadata: tool.metadata, audience: tool.audience! }),
      );
  }

  private governed(): IAbility[] {
    return this.abilities().filter((a) => a.governed);
  }

  /** The agent that is the assistant, or null while there is none. */
  async assistant(): Promise<{ id: string; name: string } | null> {
    const agent = await this.agents.findAdmin();
    return agent ? { id: agent.id, name: agent.name } : null;
  }

  // -------------------------------------------------------------- resolution

  /**
   * What the tool policy and the reach ask. `names: null` means "no setting
   * applies to this caller", never "nothing".
   */
  async grantFor(
    party: ICallerParty | null | undefined,
  ): Promise<IAssistantGrant> {
    if (!party || party.kind !== 'person') {
      return { enabled: true, names: null, level: 'owner' };
    }
    if (!isAssistantRole(party.role)) {
      return { enabled: true, names: null, level: 'owner' };
    }
    const effective = await this.effectiveFor(party.userId, party.role);
    return {
      enabled: effective.enabled,
      names: this.offeredNames(party.role, effective),
      level: effective.level,
    };
  }

  private async effectiveFor(
    userId: string,
    role: AssistantRole,
  ): Promise<IEffective> {
    const own = await this.gateway.findAccount(userId);
    if (own) return { ...this.pickFields(own), source: 'account' };
    return this.effectiveForRole(role);
  }

  private async effectiveForRole(role: AssistantRole): Promise<IEffective> {
    const row = await this.gateway.findRole(role);
    if (row) return { ...this.pickFields(row), source: 'role' };
    return {
      ...ASSISTANT_ROLE_DEFAULTS[role],
      custom: null,
      source: 'role',
      updatedAt: null,
    };
  }

  private pickFields(row: IAssistantSettingData) {
    return {
      enabled: row.enabled,
      level: row.level,
      custom: row.custom,
      updatedAt: row.updatedAt,
    };
  }

  /** The names a setting holds, before the role is considered. */
  private chosenNames(setting: {
    level: AssistantLevelOrCustom;
    custom: IAssistantCustom | null;
  }): Set<string> {
    const governed = this.governed();
    if (setting.level !== 'custom') return levelSet(setting.level, governed);
    // A name that left the catalogue leaves the pick with it.
    const exists = new Set(governed.map((a) => a.name));
    return new Set((setting.custom?.on ?? []).filter((n) => exists.has(n)));
  }

  /** What a role can have at all: the ceiling no setting lifts. */
  private ceilingOf(role: UserRoleTypes): IAbility[] {
    return this.governed().filter((a) => withinCeiling(a, role));
  }

  private offeredNames(
    role: UserRoleTypes,
    setting: { level: AssistantLevelOrCustom; custom: IAssistantCustom | null },
  ): Set<string> {
    const chosen = this.chosenNames(setting);
    return new Set(
      this.ceilingOf(role)
        .filter((a) => chosen.has(a.name))
        .map((a) => a.name),
    );
  }

  private resolved(
    role: UserRoleTypes,
    effective: IEffective,
  ): IAssistantResolved {
    const offered = this.offeredNames(role, effective);
    const matches =
      effective.level === 'custom'
        ? (ASSISTANT_LEVELS.find((level) =>
            sameSet(offered, this.offeredNames(role, { level, custom: null })),
          ) ?? null)
        : null;
    return {
      enabled: effective.enabled,
      level: effective.level,
      matchesLevel: matches,
      source: effective.source,
      offered: offered.size,
      available: this.ceilingOf(role).length,
      version: versionOf(effective.updatedAt),
    };
  }

  private pickOf(effective: IEffective): IAssistantPick | null {
    if (effective.level !== 'custom' || !effective.custom) return null;
    const governed = this.governed().map((a) => a.name);
    const exists = new Set(governed);
    const known = new Set(effective.custom.known);
    return {
      on: effective.custom.on.filter((n) => exists.has(n)).sort(),
      new: governed.filter((n) => !known.has(n)).sort(),
    };
  }

  // ------------------------------------------------------------------- roles

  async roleView(role: AssistantRole): Promise<IAssistantRoleView> {
    const effective = await this.effectiveForRole(role);
    return { ...this.resolved(role, effective), pick: this.pickOf(effective) };
  }

  async rolePick(role: AssistantRole): Promise<IAssistantPick | null> {
    return this.pickOf(await this.effectiveForRole(role));
  }

  async setRole(
    editor: IAssistantEditor,
    role: AssistantRole,
    input: IAssistantSettingInput,
  ): Promise<IAssistantRoleView> {
    if (!isAssistantRole(role)) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.BadRole,
        ASSISTANT_ACCESS_REFUSALS.owner,
      );
    }
    if (!isOwnerEditor(editor)) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.NotAllowed,
        ASSISTANT_ACCESS_REFUSALS.roles,
      );
    }
    const before = await this.effectiveForRole(role);
    this.assertFresh(input, before);
    const next = this.merge(role, before, input);
    await this.gateway.saveRole(role, {
      ...next,
      updatedById: editor.kind === 'person' ? editor.userId : null,
    });
    this.audit(editor, `role ${role}`, before, next);
    return this.roleView(role);
  }

  // ---------------------------------------------------------------- accounts

  async accountView(
    editor: IAssistantEditor,
    userId: string,
  ): Promise<IAssistantAccountView> {
    const target = await this.requireTarget(userId);
    const refused = this.refuseEdit(editor, target);
    // The Owner's own page is still a page: it says there is nothing to set.
    const visible =
      refused === null ||
      (target.role === UserRoleTypes.Owner && isOwnerEditor(editor));
    if (!visible) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.NotAllowed,
        refused ?? ASSISTANT_ACCESS_REFUSALS.notAllowed,
      );
    }

    if (!isAssistantRole(target.role)) {
      const all = this.ceilingOf(target.role).length;
      return {
        userId,
        role: target.role,
        enabled: true,
        level: 'full',
        matchesLevel: null,
        source: 'owner',
        offered: all,
        available: all,
        version: null,
        pick: null,
        roleSetting: null,
        editable: false,
        ceiling: null,
      };
    }

    const effective = await this.effectiveFor(userId, target.role);
    const ofRole = await this.effectiveForRole(target.role);
    return {
      userId,
      role: target.role,
      ...this.resolved(target.role, effective),
      pick: this.pickOf(effective),
      roleSetting: this.resolved(target.role, ofRole),
      editable: refused === null,
      ceiling: await this.editorCeiling(editor),
    };
  }

  async setAccount(
    editor: IAssistantEditor,
    userId: string,
    input: IAssistantSettingInput,
  ): Promise<IAssistantAccountView> {
    const target = await this.requireEditable(editor, userId);
    const before = await this.effectiveFor(userId, target.role);
    this.assertFresh(
      input,
      before.source === 'account' ? before : { updatedAt: null },
    );
    const next = this.merge(target.role, before, input);

    // An Admin hands out no more than the assistant offers the Admin. Taking
    // the assistant away is always within that.
    const limit = await this.editorCeiling(editor);
    if (limit && next.enabled) {
      const own = new Set(limit);
      const above = [...this.offeredNames(target.role, next)]
        .filter((name) => !own.has(name))
        .sort();
      if (above.length) {
        throw new AssistantAccessError(
          AssistantAccessErrorCodes.AboveYourOwn,
          ASSISTANT_ACCESS_REFUSALS.aboveYourOwn,
          above,
        );
      }
    }

    await this.gateway.saveAccount(userId, {
      ...next,
      updatedById: editor.kind === 'person' ? editor.userId : null,
    });
    this.audit(editor, `account ${userId}`, before, next);
    return this.accountView(editor, userId);
  }

  /** Back to the role's setting. Fine when there was nothing to drop. */
  async resetAccount(
    editor: IAssistantEditor,
    userId: string,
  ): Promise<IAssistantAccountView> {
    const target = await this.requireEditable(editor, userId);
    const before = await this.effectiveFor(userId, target.role);
    const removed = await this.gateway.deleteAccount(userId);
    if (removed) {
      this.audit(editor, `account ${userId}`, before, null);
    }
    return this.accountView(editor, userId);
  }

  /** The exception goes with the account. */
  async removeUser(userId: string): Promise<void> {
    await this.gateway.deleteAccount(userId);
  }

  // ---------------------------------------------------------------- overview

  async overview(editor: IAssistantEditor): Promise<IAssistantOverview> {
    if (!isOwnerEditor(editor)) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.NotAllowed,
        ASSISTANT_ACCESS_REFUSALS.roles,
      );
    }
    const [assistant, people, rows, admins, users] = await Promise.all([
      this.assistant(),
      this.users.findAll(),
      this.gateway.listAccounts(),
      this.roleView(UserRoleTypes.Admin),
      this.roleView(UserRoleTypes.User),
    ]);
    const byId = new Map(people.map((p) => [p.id, p]));
    const excepted = new Set(rows.map((r) => r.userId));
    const following = (role: AssistantRole) =>
      people.filter((p) => p.role === role && !excepted.has(p.id)).length;

    const exceptions: IAssistantException[] = [];
    for (const row of rows) {
      const person = byId.get(row.userId);
      // A row whose account is gone, or is the Owner's now, applies to nobody.
      if (!person || !isAssistantRole(person.role)) continue;
      const effective: IEffective = {
        ...this.pickFields(row),
        source: 'account',
      };
      const chosen = this.chosenNames(effective);
      const offered = this.offeredNames(person.role, effective);
      exceptions.push({
        userId: person.id,
        name: person.name,
        email: person.email,
        role: person.role,
        resolved: this.resolved(person.role, effective),
        updatedBy: row.updatedById
          ? (byId.get(row.updatedById)?.name ?? null)
          : null,
        updatedAt: row.updatedAt,
        reducedByRole:
          effective.level === 'custom' && chosen.size > offered.size,
      });
    }

    return {
      assistant,
      roles: {
        [UserRoleTypes.Admin]: {
          ...admins,
          accounts: following(UserRoleTypes.Admin),
        },
        [UserRoleTypes.User]: {
          ...users,
          accounts: following(UserRoleTypes.User),
        },
      } as IAssistantOverview['roles'],
      exceptions,
    };
  }

  /**
   * Every ability with the levels it belongs to, area by area: what the
   * Advanced panel draws. The same for every caller; what a role cannot have
   * is told by `minRole`.
   */
  catalog(): IAssistantCatalog {
    const abilities = this.abilities();
    const describe = (ability: IAbility): IAssistantCatalogAbility => ({
      name: ability.name,
      title: ability.title,
      area: ability.area,
      effect: ability.effect,
      destructive: ability.destructive,
      minRole: ability.minRole,
      levels: ability.governed ? levelsOf(ability) : [],
    });
    const areas = new Map<ToolTopic, IAssistantCatalogArea>();
    for (const ability of abilities.filter((a) => a.governed)) {
      const info = TOOL_TOPIC_INFO[ability.area];
      const area = areas.get(ability.area) ?? {
        key: ability.area,
        title: info?.title ?? ability.area,
        order: info?.order ?? 0,
        abilities: [],
      };
      area.abilities.push(describe(ability));
      areas.set(ability.area, area);
    }
    return {
      areas: [...areas.values()]
        .map((area) => ({
          ...area,
          abilities: area.abilities.sort((a, b) =>
            a.title.localeCompare(b.title),
          ),
        }))
        .sort((a, b) => a.order - b.order),
      alwaysOn: abilities.filter((a) => !a.governed).map(describe),
    };
  }

  // ------------------------------------------------------------- explaining

  /**
   * What each level holds for a role, area by area. Built from the same rule
   * that is enforced, so the assistant explains a level from this and never
   * from text it carries (FR-033).
   */
  levelsFor(role: UserRoleTypes): IAssistantLevelInfo[] {
    return ASSISTANT_LEVELS.map((level) => ({
      key: level,
      title: LEVEL_TITLES[level],
      summary: ASSISTANT_LEVEL_SUMMARIES[level],
      areas: this.areaCounts(
        role,
        this.offeredNames(role, { level, custom: null }),
      ),
    }));
  }

  /** What a person is told about themselves. Nothing about anybody else. */
  async myAccess(
    party: ICallerParty | null | undefined,
  ): Promise<IAssistantMine> {
    const role = party?.kind === 'person' ? party.role : UserRoleTypes.Owner;
    if (party?.kind !== 'person' || !isAssistantRole(role)) {
      const all = new Set(this.ceilingOf(role).map((a) => a.name));
      return {
        enabled: true,
        level: 'owner',
        matchesLevel: null,
        areas: this.areaCounts(role, all),
        leftOut: [],
      };
    }
    const effective = await this.effectiveFor(party.userId, role);
    if (!effective.enabled) {
      return {
        enabled: false,
        level: effective.level,
        matchesLevel: null,
        areas: [],
        leftOut: [],
      };
    }
    const offered = this.offeredNames(role, effective);
    return {
      enabled: true,
      level: effective.level,
      matchesLevel: this.resolved(role, effective).matchesLevel,
      areas: this.areaCounts(role, offered),
      leftOut: this.ceilingOf(role)
        .filter((a) => !offered.has(a.name))
        .map((a) => ({ name: a.name, title: a.title, area: a.area })),
    };
  }

  private areaCounts(
    role: UserRoleTypes,
    offered: ReadonlySet<string>,
  ): IAssistantAreaCount[] {
    const counts = new Map<ToolTopic, IAssistantAreaCount>();
    for (const ability of this.ceilingOf(role)) {
      const info = TOOL_TOPIC_INFO[ability.area];
      const area = counts.get(ability.area) ?? {
        key: ability.area,
        title: info?.title ?? ability.area,
        offered: 0,
        available: 0,
      };
      area.available += 1;
      if (offered.has(ability.name)) area.offered += 1;
      counts.set(ability.area, area);
    }
    return [...counts.values()].sort(
      (a, b) =>
        (TOOL_TOPIC_INFO[a.key]?.order ?? 0) -
        (TOOL_TOPIC_INFO[b.key]?.order ?? 0),
    );
  }

  // ------------------------------------------------------------------- rules

  /**
   * Who may change whose setting. The same people as for the agent lists
   * (specs/032, `refuseAccessEdit`): the Owner changes Admins and Users, an
   * Admin changes Users, nobody changes the Owner's or their own.
   */
  refuseEdit(
    editor: IAssistantEditor,
    target: { id: string; role: UserRoleTypes },
  ): string | null {
    if (target.role === UserRoleTypes.Owner)
      return ASSISTANT_ACCESS_REFUSALS.owner;
    if (editor.kind === 'trusted') return null;
    if (target.id === editor.userId) return ASSISTANT_ACCESS_REFUSALS.self;
    if (editor.role === UserRoleTypes.Owner) return null;
    if (editor.role !== UserRoleTypes.Admin) {
      return ASSISTANT_ACCESS_REFUSALS.notAllowed;
    }
    if (target.role === UserRoleTypes.Admin) {
      return ASSISTANT_ACCESS_REFUSALS.otherAdmin;
    }
    return target.role === UserRoleTypes.User
      ? null
      : ASSISTANT_ACCESS_REFUSALS.notAllowed;
  }

  /** The names an Admin editor may hand out; null for the Owner. */
  private async editorCeiling(
    editor: IAssistantEditor,
  ): Promise<string[] | null> {
    if (isOwnerEditor(editor) || editor.kind !== 'person') return null;
    if (!isAssistantRole(editor.role)) return null;
    const own = await this.effectiveFor(editor.userId, editor.role);
    return own.enabled ? [...this.offeredNames(editor.role, own)].sort() : [];
  }

  private async requireTarget(
    userId: string,
  ): Promise<{ id: string; role: UserRoleTypes }> {
    const user = userId ? await this.users.findById(userId) : null;
    if (!user) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.UserNotFound,
        ASSISTANT_ACCESS_REFUSALS.userNotFound,
      );
    }
    return { id: user.id, role: user.role };
  }

  private async requireEditable(
    editor: IAssistantEditor,
    userId: string,
  ): Promise<{ id: string; role: AssistantRole }> {
    const target = await this.requireTarget(userId);
    const refused = this.refuseEdit(editor, target);
    if (refused !== null || !isAssistantRole(target.role)) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.NotAllowed,
        refused ?? ASSISTANT_ACCESS_REFUSALS.notAllowed,
      );
    }
    return { id: target.id, role: target.role };
  }

  private assertFresh(
    input: IAssistantSettingInput,
    current: { updatedAt: Date | null },
  ): void {
    if (input.version === undefined || input.version === null) return;
    if (input.version !== versionOf(current.updatedAt)) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.Stale,
        ASSISTANT_ACCESS_REFUSALS.stale,
      );
    }
  }

  /**
   * What was there, with what was asked for on top. A custom pick is checked
   * against the catalogue and the role here, so nothing is stored that could
   * never apply.
   */
  private merge(
    role: UserRoleTypes,
    before: IEffective,
    input: IAssistantSettingInput,
  ): Pick<IAssistantSettingData, 'enabled' | 'level' | 'custom'> {
    const enabled = input.enabled ?? before.enabled;
    const level = input.level ?? before.level;
    if (level !== 'custom' && !isAssistantLevel(level)) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.BadLevel,
        `There is no level "${String(level)}".`,
      );
    }
    if (level !== 'custom') return { enabled, level, custom: null };

    // Custom without a new list keeps the stored pick.
    if (input.on === undefined && before.level === 'custom' && before.custom) {
      return { enabled, level, custom: before.custom };
    }

    const governed = this.governed();
    const byName = new Map(governed.map((a) => [a.name, a]));
    const on = [...new Set(input.on ?? [])].sort();

    const unknown = on.filter((name) => !byName.has(name));
    if (unknown.length) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.UnknownAbility,
        ASSISTANT_ACCESS_REFUSALS.unknownAbility,
        unknown,
      );
    }
    const above = on.filter((name) => !withinCeiling(byName.get(name)!, role));
    if (above.length) {
      throw new AssistantAccessError(
        AssistantAccessErrorCodes.AboveRole,
        ASSISTANT_ACCESS_REFUSALS.aboveRole,
        above,
      );
    }
    return {
      enabled,
      level,
      custom: { on, known: governed.map((a) => a.name).sort() },
    };
  }

  /** FR-031: who changed what for whom. Counts and levels, never names of people beyond ids. */
  private audit(
    editor: IAssistantEditor,
    target: string,
    before: {
      enabled: boolean;
      level: string;
      custom: IAssistantCustom | null;
    },
    after: {
      enabled: boolean;
      level: string;
      custom: IAssistantCustom | null;
    } | null,
  ): void {
    const say = (s: typeof before | null) =>
      s
        ? `${s.enabled ? 'on' : 'off'}/${s.level}${
            s.level === 'custom' ? `(${s.custom?.on.length ?? 0})` : ''
          }`
        : 'role setting';
    const who = editor.kind === 'person' ? editor.userId : 'trusted';
    this.logger.log(
      `assistant access: ${who} changed ${target} from ${say(before)} to ${say(after)}`,
    );
  }
}
