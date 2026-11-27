import { Injectable } from '@nestjs/common';
import type { IAgentManagerResolver } from '#/mcp/interfaces/agent-manager.interface';
import {
  highestPersonRole,
  type IAuthTokenPayload,
  type ICallerParty,
} from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';
import { IAgentGateway } from './agent.gateway';
import type { IAgentData } from './agent.types';

/** A signed-in person, as the role guard or an acting token proved them. */
export interface IManagingPerson {
  userId: string;
  role: UserRoleTypes;
}

/** What `canManage` needs to know about the agent. */
export type IManagedAgent = Pick<IAgentData, 'id' | 'isAdmin' | 'createdById'>;

/**
 * Whether an account reaches an agent at all. Until the access lists of
 * CLEAN-231 exist every account reaches every agent, so the default provider
 * answers yes; that feature replaces the provider and nothing here changes.
 * An abstract class so it is its own injection token, like `IAgentGateway`.
 */
export abstract class IAgentReach {
  abstract reaches(caller: IManagingPerson, agentId: string): Promise<boolean>;
}

/** The default: no access lists yet, everybody reaches every agent. */
@Injectable()
export class OpenAgentReach extends IAgentReach {
  reaches(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const GUEST: ICallerParty = { kind: 'guest' };

/**
 * Who may manage one agent (CLEAN-232, contract section 5). One rule for the
 * management routes and for the `manage-agent` tools:
 *
 *   canManage(caller, agent) =
 *        caller is the Owner
 *     OR (agent is not the Ranch admin agent AND caller is an Admin
 *         AND caller reaches the agent)
 *     OR (agent is not the Ranch admin agent AND caller created the agent
 *         AND caller reaches the agent)
 *     OR (agent is not the Ranch admin agent AND the tool this call runs
 *         was ticked for the caller in a custom pick of the assistant
 *         setting AND caller reaches the agent)
 *
 * The caller is a party (`ICallerParty`): a person, a trusted agent, or a
 * guest. A trusted party is the Ranch admin agent acting for itself and is
 * allowed, as before. A guest never is.
 *
 * The last line is for tools only, and for one tool at a time (CLEAN-254).
 * The Owner or an Admin ticks agent abilities for a person in a custom pick
 * of the assistant setting (CLEAN-240); such an ability works through the
 * assistant on every agent that person reaches, whoever created it. A
 * built-in level (basic, standard, full) never does: nothing widens by
 * default, and for a User a level's agent abilities stay with line three. It arrives here as
 * `grantedThroughAssistant` on the party, which `manageCaller` sets when the
 * call came through the assistant and a custom pick holds the very tool
 * being called. `callerOfBearer` never sets it, so the management routes and
 * `AgentManageGuard` keep the first three lines: a User manages nothing in
 * the console by having been given `restart_agent` in the chat. Nor does
 * the line widen which agents: those are the ones the access lists give.
 *
 * The Ranch admin agent is the Owner's alone. Its workspace files, secrets,
 * schedule and restart are Owner power for whoever edits them: an Admin who
 * could rewrite its HEARTBEAT.md would get a scheduled turn that runs as a
 * trusted party. So neither the Admin line, nor the creator line, nor the
 * assistant-setting line applies to it, whoever created it.
 *
 * The creator line does little today, because only an Owner or Admin can
 * create an agent. It is what keeps an agent with the person who made it
 * after a demotion, and it is the line that opens when creation opens to
 * Users: one change to who may call `POST /agents`, not a second pass over
 * every route and tool.
 *
 * A refusal is never told apart from an unknown agent: `manageable` hands
 * back null for both, and callers answer their own "not found".
 *
 * One case is told apart, and only in what a tool says, never in what it
 * allows (CLEAN-263): the Ranch admin agent, named by a person who is not
 * the Owner and reaches it. That person is talking to it and is shown it by
 * `list_agents`, so "not found" hid nothing and read as a fault. They are
 * told that only the Owner can restart, stop or change it
 * (`ownerOnlyAgentFor`, noted by the MCP handler, said by `agentNotFound`).
 * The routes keep their 404; the consoles do not offer the action there.
 */
@Injectable()
export class AgentPermissionService implements IAgentManagerResolver {
  constructor(
    private readonly agents: IAgentGateway,
    private readonly reach: IAgentReach,
  ) {}

  async canManage(
    caller: ICallerParty,
    agent: IManagedAgent,
  ): Promise<boolean> {
    if (caller.kind === 'trusted') return true;
    if (caller.kind !== 'person') return false;
    if (caller.role === UserRoleTypes.Owner) return true;
    if (agent.isAdmin) return false;

    const isAdmin = caller.role === UserRoleTypes.Admin;
    // An empty id on either side is no creator at all, never a match.
    const isCreator =
      typeof agent.createdById === 'string' &&
      agent.createdById !== '' &&
      agent.createdById === caller.userId;
    // Set by `manageCaller` for one tool call and by nothing else: the tool
    // being called is one the assistant setting gave this person.
    const isGranted = caller.grantedThroughAssistant === true;
    if (!isAdmin && !isCreator && !isGranted) return false;
    return (
      (await this.reach.reaches(
        { userId: caller.userId, role: caller.role },
        agent.id,
      )) === true
    );
  }

  /**
   * The agent, when it exists and the caller may manage it; null otherwise.
   * One answer for "no such agent" and "not yours", so existence is not
   * revealed.
   */
  async manageable(
    caller: ICallerParty,
    agentId: string,
  ): Promise<IAgentData | null> {
    if (caller.kind === 'guest' || !agentId) return null;
    const agent = await this.agents.findById(agentId);
    if (!agent) return null;
    return (await this.canManage(caller, agent)) ? agent : null;
  }

  /**
   * The agents this caller reaches and still does not manage because they
   * are the Owner's alone: the Ranch admin agent, for anybody but the Owner.
   * What a list scoped by reach takes out when the question is one of
   * managing, such as reading the conversations people had with an agent
   * (CLEAN-236).
   */
  async ownerOnlyIds(caller: ICallerParty): Promise<string[]> {
    if (caller.kind === 'trusted') return [];
    if (caller.kind === 'person' && caller.role === UserRoleTypes.Owner) {
      return [];
    }
    const ranch = await this.agents.findAdmin();
    return ranch ? [ranch.id] : [];
  }

  /**
   * The Ranch admin agent, for a caller who reaches it and still may not
   * manage it: a person who is not the Owner and has the assistant
   * (CLEAN-263). Null for the Owner and a trusted party, who manage it; for
   * a guest; and for a person the assistant is switched off for, to whom it
   * is an agent that does not exist.
   *
   * It is what lets a `manage-agent` tool tell that one person the truth,
   * "only the Owner can", about the one agent they are talking to, where
   * `manageable` answers null for it as for an unknown id. Reach is asked
   * the way `canManage` asks it, so the assistant's own switch decides
   * (`AgentAccessService`, CLEAN-240). `manageable` and `canManage` are
   * untouched: this explains a refusal, it never allows anything.
   */
  async ownerOnlyAgentFor(
    caller: ICallerParty,
  ): Promise<{ id: string; name: string } | null> {
    if (caller.kind !== 'person') return null;
    if (caller.role === UserRoleTypes.Owner) return null;
    const ranch = await this.agents.findAdmin();
    if (!ranch) return null;
    const reaches =
      (await this.reach.reaches(
        { userId: caller.userId, role: caller.role },
        ranch.id,
      )) === true;
    return reaches ? { id: ranch.id, name: ranch.name } : null;
  }

  /**
   * Whether a person manages at least one agent: what lists the
   * `manage-agent` tools for them. An Owner or Admin always does; anybody
   * else only by having created an agent. Whether they still reach it is
   * asked per call, by `manageable`.
   */
  async managesAny(person: IManagingPerson): Promise<boolean> {
    if (
      person.role === UserRoleTypes.Owner ||
      person.role === UserRoleTypes.Admin
    ) {
      return true;
    }
    return this.agents.hasCreatedBy(person.userId);
  }

  /**
   * The caller behind a console request, from the bearer `JwtAuthGuard`
   * verified. A person's own token is that person. An agent runtime's token
   * is a guest here: on routes it is an `Agent` and manages nothing, its
   * power exists through tools only.
   */
  static callerOfBearer(
    user: Pick<IAuthTokenPayload, 'sub' | 'roles'> | null | undefined,
  ): ICallerParty {
    const sub = typeof user?.sub === 'string' ? user.sub : '';
    if (!sub || sub.startsWith('agent:')) return GUEST;
    const role = highestPersonRole(user?.roles);
    return role ? { kind: 'person', userId: sub, role } : GUEST;
  }
}
