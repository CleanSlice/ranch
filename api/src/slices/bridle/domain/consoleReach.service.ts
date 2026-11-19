import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { AgentAccessService } from '#/user/agentAccess/domain/agentAccess.service';
import { accessSubject } from '#/user/agentAccess/domain/agentAccess.types';
import type { UserRoleTypes } from '#/user/user/domain/user.types';
import type { IConsoleSession } from './chatIdentity';

/** What the chat surface answers a console person for an agent they cannot use. */
export const CHAT_AGENT_NOT_FOUND = 'Agent not found';

/** The socket twin of it: the `code` of the `bridle_error` before the drop. */
export const CHAT_AGENT_NOT_FOUND_CODE = 'AGENT_NOT_FOUND';

/**
 * The access lists on the chat surface (CLEAN-231). One rule for the HTTP
 * message, attachment and transcript routes and for the browser socket:
 *
 * a console person whose role is Admin or User may talk to an agent only
 * when their lists reach it. Everybody else is not asked: the Owner, a share
 * visitor, an embed token, an anonymous visitor (FR-011). `session` is the
 * person's own console token as `consoleSessionOf` read it; null for all of
 * those others.
 *
 * For a person the lists apply to, an agent that does not exist is refused
 * the same way as one that is hidden, so the two cannot be told apart.
 */
@Injectable()
export class ConsoleReachService {
  constructor(
    private readonly access: AgentAccessService,
    @Inject(forwardRef(() => IAgentGateway))
    private readonly agents: IAgentGateway,
  ) {}

  /** The person the lists apply to behind this session, or null. */
  subjectOf(session: IConsoleSession | null | undefined) {
    if (!session) return null;
    return accessSubject({
      userId: session.userId,
      role: session.role as UserRoleTypes,
    });
  }

  /** Whether this session may use the chat of that agent. */
  async admits(
    session: IConsoleSession | null | undefined,
    agentId: string,
  ): Promise<boolean> {
    const subject = this.subjectOf(session);
    if (!subject) return true;
    if (!(await this.access.reaches(subject, agentId))) return false;
    return (await this.agents.findById(agentId)) !== null;
  }

  /** The ids of a list this session reaches; everything for a non-subject. */
  async reached<T>(
    session: IConsoleSession | null | undefined,
    items: readonly T[],
    agentIdOf: (item: T) => string,
  ): Promise<T[]> {
    const reach = await this.access.reachableIds(this.subjectOf(session));
    return reach.filter(items, agentIdOf);
  }

  /** Called when an account was deleted; see `AgentAccessService`. */
  onRemoved(listener: (userId: string) => void): () => void {
    return this.access.onRemoved(listener);
  }

  /** Called when an account's access changed; see `AgentAccessService`. */
  onChanged(listener: (userId: string) => void): () => void {
    return this.access.onChanged(listener);
  }
}
