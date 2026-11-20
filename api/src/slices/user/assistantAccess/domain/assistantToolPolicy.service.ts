import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CallerToolPolicy } from '#/mcp/interfaces/caller-tool-policy.interface';
import { callerAgentId, callerParty } from '#/mcp/tooling';
import { AssistantAccessService } from './assistantAccess.service';

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
 */
@Injectable()
export class AssistantToolPolicyService extends CallerToolPolicy {
  // One answer per request: a turn lists and calls several times.
  private readonly memo = new WeakMap<Request, Promise<Set<string> | null>>();

  constructor(private readonly access: AssistantAccessService) {
    super();
  }

  allowedToolsFor(httpRequest: Request): Promise<Set<string> | null> {
    let pending = this.memo.get(httpRequest);
    if (!pending) {
      pending = this.resolve(httpRequest);
      this.memo.set(httpRequest, pending);
    }
    return pending;
  }

  private async resolve(httpRequest: Request): Promise<Set<string> | null> {
    const agentId = callerAgentId(httpRequest);
    if (!agentId) return null;
    const assistant = await this.access.assistant();
    if (!assistant || assistant.id !== agentId) return null;

    const grant = await this.access.grantFor(callerParty(httpRequest));
    if (grant.names === null) return null;

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
}
