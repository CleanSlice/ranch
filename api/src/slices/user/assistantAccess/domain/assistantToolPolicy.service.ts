import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { IAssistantGrantResolver } from '#/mcp/interfaces/assistant-grant.interface';
import { CallerToolPolicy } from '#/mcp/interfaces/caller-tool-policy.interface';
import { callerAgentId, callerParty } from '#/mcp/tooling';
import { AssistantAccessService } from './assistantAccess.service';
import type { IAssistantGrant } from './assistantAccess.types';

/** Tells a person what they have; no setting may hide it from them. */
export const MY_ASSISTANT_ACCESS_TOOL = 'get_my_assistant_access';

/**
 * Which tools the assistant offers the person it is answering (CLEAN-240).
 *
 * It has an opinion about exactly one case: the call carries the assistant's
 * own token, and it is made for a signed-in Admin or User. Then the answer
 * is what that person's setting includes. For everything else it answers
 * `null`, "not mine to narrow":
 *
 * - another agent, whoever it is answering;
 * - a person calling with their own console token — their console power is
 *   theirs, the setting is about what the assistant does for them;
 * - the Owner, the assistant acting for itself, a guest.
 *
 * The role's ceiling is not checked here. The catalogue applies the audience
 * before it asks any policy, and a policy can only take names away, so
 * nothing this returns can give a person what their role does not have.
 *
 * One thing the same setting does open (CLEAN-254): an agent ability ticked
 * in a custom pick works on every agent the person reaches, though they
 * created none. A built-in level opens nothing of the kind.
 * That is `grantedToolsFor`, asked by the tool layer through
 * `ASSISTANT_GRANT_RESOLVER`; the role's ceiling still holds, because the
 * names come from `grantFor`, which cuts them down to the role.
 */
@Injectable()
export class AssistantToolPolicyService
  extends CallerToolPolicy
  implements IAssistantGrantResolver
{
  // One answer per request: a turn lists and calls several times, and the
  // policy and the grant below are asked about the same call.
  private readonly memo = new WeakMap<
    Request,
    Promise<IAssistantGrant | null>
  >();

  constructor(private readonly access: AssistantAccessService) {
    super();
  }

  async allowedToolsFor(httpRequest: Request): Promise<Set<string> | null> {
    const grant = await this.settingFor(httpRequest);
    if (!grant || grant.names === null) return null;

    // What the assistant needs to hold any conversation is no setting's to
    // take: its own audiences are left as the catalogue found them.
    const allowed = new Set(
      this.access
        .abilities()
        .filter((ability) => !ability.governed)
        .map((ability) => ability.name),
    );
    if (!grant.enabled) return allowed;
    for (const name of grant.names) allowed.add(name);
    allowed.add(MY_ASSISTANT_ACCESS_TOOL);
    return allowed;
  }

  /**
   * The abilities the setting gives the person this call is made for
   * (CLEAN-254): what makes an agent ability work for somebody who manages
   * no agent. Read from the same setting the policy above narrows by, so the
   * two cannot disagree about a call.
   *
   * Only what was ticked for them counts: the names of a CUSTOM pick, the
   * account's own or the role's. A built-in level (basic, standard, full),
   * the role's default or one somebody chose, opens nothing here: nothing
   * widens for anybody without somebody having chosen that ability. It is
   * read from the stored level, not from comparing sets, so a custom pick
   * that happens to equal Standard is still a custom pick and counts.
   *
   * `null` wherever no setting is behind the call, for a setting that is
   * switched off, and for a built-in level: another agent, a console token,
   * a guest, the Owner. Every name in the set is a governed ability within
   * the person's role; which of them are tools for managing an agent is the
   * tool layer's to say.
   */
  async grantedToolsFor(
    httpRequest: Request,
  ): Promise<ReadonlySet<string> | null> {
    const grant = await this.settingFor(httpRequest);
    if (!grant || grant.names === null || !grant.enabled) return null;
    if (grant.level !== 'custom') return null;
    return grant.names;
  }

  /** The setting behind this call; null when the call is not the assistant's. */
  private settingFor(httpRequest: Request): Promise<IAssistantGrant | null> {
    let pending = this.memo.get(httpRequest);
    if (!pending) {
      pending = this.resolve(httpRequest);
      this.memo.set(httpRequest, pending);
    }
    return pending;
  }

  private async resolve(httpRequest: Request): Promise<IAssistantGrant | null> {
    const agentId = callerAgentId(httpRequest);
    if (!agentId) return null;
    const assistant = await this.access.assistant();
    if (!assistant || assistant.id !== agentId) return null;
    return this.access.grantFor(callerParty(httpRequest));
  }
}
