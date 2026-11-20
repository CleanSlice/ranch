import type {
  ToolAudienceTypes,
  ToolMetadata,
  ToolTopic,
} from '#/mcp/decorators';
import { ToolTopics } from '#/mcp/decorators/topics';
import { UserRoleTypes } from '#/user/user/domain/user.types';

// What the assistant offers a person, as a rule (CLEAN-240, FR-010). A level
// is decided by three things every tool already states — its area, whether
// it only reads, and its audience — so a tool added next month lands in the
// right levels without anyone remembering that levels exist.

export const ASSISTANT_LEVELS = ['basic', 'standard', 'full'] as const;
export type AssistantLevel = (typeof ASSISTANT_LEVELS)[number];

export function isAssistantLevel(value: unknown): value is AssistantLevel {
  return (ASSISTANT_LEVELS as readonly unknown[]).includes(value);
}

/** A tool as the settings see it. */
export interface IAbility {
  name: string;
  title: string;
  area: ToolTopic;
  effect: 'read' | 'write';
  destructive: boolean;
  audience: ToolAudienceTypes;
  /** The lowest role whose console can do this. */
  minRole: UserRoleTypes;
  /** False for what the assistant needs to hold any conversation at all. */
  governed: boolean;
}

/**
 * A setting decides what a *person* gets. The `everyone` and `agent`
 * audiences are the assistant's own: reading an attachment it was sent,
 * searching its knowledge, its own colleagues. Take those away and it cannot
 * answer anybody, so no setting reaches them.
 */
export function isGoverned(audience: ToolAudienceTypes): boolean {
  return audience !== 'everyone' && audience !== 'agent';
}

export function minRoleOf(audience: ToolAudienceTypes): UserRoleTypes {
  if (audience === 'owner') return UserRoleTypes.Owner;
  if (audience === 'admin') return UserRoleTypes.Admin;
  return UserRoleTypes.User;
}

export function abilityOf(tool: {
  metadata: Pick<
    ToolMetadata,
    'name' | 'title' | 'topic' | 'effect' | 'destructive'
  >;
  audience: ToolAudienceTypes;
}): IAbility {
  return {
    name: tool.metadata.name,
    title: tool.metadata.title,
    area: tool.metadata.topic,
    effect: tool.metadata.effect,
    destructive: tool.metadata.destructive === true,
    audience: tool.audience,
    minRole: minRoleOf(tool.audience),
    governed: isGoverned(tool.audience),
  };
}

/** The areas where Standard may change things: the day-to-day work on agents. */
export const STANDARD_AREAS: ReadonlySet<ToolTopic> = new Set<ToolTopic>([
  ToolTopics.Agents,
  ToolTopics.AgentWorkspace,
  ToolTopics.Knowledge,
  ToolTopics.Skills,
  ToolTopics.Peers,
  ToolTopics.Paddock,
]);

/** One sentence per level, for whoever has to explain them. */
export const ASSISTANT_LEVEL_SUMMARIES: Record<AssistantLevel, string> = {
  basic:
    'See and ask: everything that only reads, plus what is personal to the ' +
    'person. Changes nothing that belongs to anyone else.',
  standard:
    'Basic, plus the day-to-day work on agents: create, start, stop, ' +
    'restart and edit them, their files, knowledge, skills, colleagues and ' +
    'test runs. Nothing about users, keys, models, connected services, ' +
    'templates or installation settings.',
  full: 'Everything the role can do in the console.',
};

/** The lowest level an ability belongs to. */
export function levelOf(ability: IAbility): AssistantLevel {
  // `person` tools are the person's own things (a pin, their browser
  // sessions): personal, whatever they write.
  if (ability.effect === 'read' || ability.audience === 'person')
    return 'basic';
  if (STANDARD_AREAS.has(ability.area)) return 'standard';
  return 'full';
}

const RANK: Record<AssistantLevel, number> = { basic: 0, standard: 1, full: 2 };

/** The levels an ability is part of, lowest first. */
export function levelsOf(ability: IAbility): AssistantLevel[] {
  const lowest = RANK[levelOf(ability)];
  return ASSISTANT_LEVELS.filter((level) => RANK[level] >= lowest);
}

/**
 * The names a level holds, before any role is considered. What a person
 * actually gets is this set cut down to what their role's audiences allow —
 * that cut is the catalogue's, and it happens first.
 */
export function levelSet(
  level: AssistantLevel,
  abilities: readonly IAbility[],
): Set<string> {
  return new Set(
    abilities
      .filter((a) => a.governed && RANK[levelOf(a)] <= RANK[level])
      .map((a) => a.name),
  );
}

/** Whether a role's console can do this at all — the ceiling no setting lifts. */
export function withinCeiling(ability: IAbility, role: UserRoleTypes): boolean {
  if (role === UserRoleTypes.Owner) return true;
  if (ability.minRole === UserRoleTypes.Owner) return false;
  if (ability.minRole === UserRoleTypes.Admin)
    return role === UserRoleTypes.Admin;
  return role === UserRoleTypes.Admin || role === UserRoleTypes.User;
}
