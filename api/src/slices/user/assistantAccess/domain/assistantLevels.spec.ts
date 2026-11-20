import {
  IAbility,
  abilityOf,
  isGoverned,
  levelSet,
  minRoleOf,
} from './assistantLevels';
import { UserRoleTypes } from '#/user/user/domain/user.types';

const ability = (
  name: string,
  area: string,
  effect: 'read' | 'write',
  audience: string,
): IAbility =>
  abilityOf({
    metadata: { name, title: name, topic: area, effect } as never,
    audience: audience as never,
  });

const ABILITIES: IAbility[] = [
  ability('list_agents', 'agents', 'read', 'reader'),
  ability('restart_agent', 'agents', 'write', 'manage-agent'),
  ability('pin_agent', 'agents', 'write', 'person'),
  ability('write_agent_file', 'agent_workspace', 'write', 'manage-agent'),
  ability('list_knowledges', 'knowledge', 'read', 'admin'),
  ability('create_knowledge', 'knowledge', 'write', 'admin'),
  ability('create_skill', 'skills', 'write', 'admin'),
  ability('connect_agent_peer', 'peers', 'write', 'manage-agent'),
  ability('run_paddock_evaluation', 'paddock', 'write', 'admin'),
  ability('update_template', 'templates', 'write', 'admin'),
  ability('create_user', 'users_keys', 'write', 'admin'),
  ability('list_users', 'users_keys', 'read', 'admin'),
  ability('upsert_setting', 'settings', 'write', 'admin'),
  ability('delete_user', 'users_keys', 'write', 'owner'),
  ability('query_knowledge', 'knowledge', 'read', 'everyone'),
  ability('ask_agent', 'peers', 'write', 'agent'),
];

const names = (level: 'basic' | 'standard' | 'full') =>
  [...levelSet(level, ABILITIES)].sort();

describe('levelSet', () => {
  it('Basic is everything that only reads, plus what is personal', () => {
    expect(names('basic')).toEqual([
      'list_agents',
      'list_knowledges',
      'list_users',
      'pin_agent',
    ]);
  });

  it('Standard adds the day-to-day work on agents, and nothing else', () => {
    expect(names('standard')).toEqual([
      'connect_agent_peer',
      'create_knowledge',
      'create_skill',
      'list_agents',
      'list_knowledges',
      'list_users',
      'pin_agent',
      'restart_agent',
      'run_paddock_evaluation',
      'write_agent_file',
    ]);
  });

  it('Full is every governed ability, Owner-only ones included', () => {
    expect(names('full')).toEqual(
      ABILITIES.filter((a) => a.governed)
        .map((a) => a.name)
        .sort(),
    );
    expect(names('full')).toContain('delete_user');
  });

  // The assistant needs these to hold any conversation; no setting governs
  // them, so no level may be read as "including" them either.
  it('never holds a tool of the everyone or agent audience', () => {
    for (const level of ['basic', 'standard', 'full'] as const) {
      expect(names(level)).not.toContain('query_knowledge');
      expect(names(level)).not.toContain('ask_agent');
    }
  });

  // FR-010: a tool added next month lands by rule, not by someone's list.
  it('places a tool it has never seen by its area and effect', () => {
    const next = [
      ...ABILITIES,
      ability('archive_skill', 'skills', 'write', 'admin'),
    ];
    expect(levelSet('basic', next).has('archive_skill')).toBe(false);
    expect(levelSet('standard', next).has('archive_skill')).toBe(true);
    expect(levelSet('full', next).has('archive_skill')).toBe(true);

    const read = [
      ...ABILITIES,
      ability('list_backups', 'platform', 'read', 'admin'),
    ];
    expect(levelSet('basic', read).has('list_backups')).toBe(true);
  });
});

describe('what an audience means for the settings', () => {
  it('governs what a person gets, never what the assistant itself needs', () => {
    expect(isGoverned('person')).toBe(true);
    expect(isGoverned('reader')).toBe(true);
    expect(isGoverned('manage-agent')).toBe(true);
    expect(isGoverned('admin')).toBe(true);
    expect(isGoverned('owner')).toBe(true);
    expect(isGoverned('everyone')).toBe(false);
    expect(isGoverned('agent')).toBe(false);
  });

  it('names the lowest role that may use it', () => {
    expect(minRoleOf('person')).toBe(UserRoleTypes.User);
    expect(minRoleOf('reader')).toBe(UserRoleTypes.User);
    expect(minRoleOf('manage-agent')).toBe(UserRoleTypes.User);
    expect(minRoleOf('admin')).toBe(UserRoleTypes.Admin);
    expect(minRoleOf('owner')).toBe(UserRoleTypes.Owner);
  });
});
