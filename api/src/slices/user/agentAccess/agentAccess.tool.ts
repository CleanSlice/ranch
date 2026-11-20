import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  agentNotFoundAdvice,
  callerIsOperator,
  callerParty,
  CONFIRM_SENTENCE,
  err,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { IUserGateway } from '#/user/user/domain/user.gateway';
import {
  AgentAccessError,
  AgentAccessErrorCodes,
  AgentAccessService,
  type IAccessEditor,
  type IAgentAccessOutcome,
  type IAgentAccessView,
} from './domain';

/** The four sentences of the editor, for the assistant to say. */
export function outcomeSentence(outcome: IAgentAccessOutcome): string {
  switch (outcome.kind) {
    case 'all':
      return 'Reaches every agent';
    case 'all_except':
      return `Reaches every agent except ${outcome.count}`;
    case 'only':
      return `Reaches only these ${outcome.count}`;
    default:
      return 'Reaches no agents — needs review';
  }
}

const idsSchema = (what: string) =>
  z
    .array(z.string())
    .optional()
    .describe(`Agent ids ${what} (list_agents has them)`);

/**
 * Agent access from the chat (CLEAN-231): what the "Agent access" card of a
 * user's page does, under the same rules and with the same refusals,
 * because both go through `AgentAccessService`.
 *
 * Audience `admin`, as the routes' `@Roles(Admin)`. The change is made as
 * the party the call is for: an Admin asking through the assistant meets
 * the ceiling exactly as in the console, and is shown only agents they
 * reach. Results carry agent ids and names, never a credential.
 */
@ToolAudience('admin')
@Injectable()
export class AgentAccessTool implements IConditionallyListedTool {
  private readonly logger = new Logger(AgentAccessTool.name);

  constructor(
    private readonly access: AgentAccessService,
    private readonly users: IUserGateway,
    private readonly agents: IAgentGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'get_user_agent_access',
    topic: ToolTopics.UsersKeys,
    effect: 'read',
    title: "Show a user's agent access",
    template: 'Which agents can «email» use?',
    description:
      'Which agents one user account reaches: its allowed and denied ' +
      'agents (id and name), what the two lists come to in a sentence, ' +
      'whether the account needs review (its last allowed agent was ' +
      'deleted, so it reaches none), and whether it has access the caller ' +
      'cannot see. Only agents the caller reaches are shown. Takes the ' +
      'user id — list_users turns an email into one. The Owner may read ' +
      'any account; an Admin only accounts with the User role.',
    parameters: z.object({
      userId: z.string().describe('User id, e.g. user-… (list_users has them)'),
    }),
  })
  async getUserAgentAccess(
    { userId }: { userId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    try {
      const view = await this.access.view(editorOf(httpRequest), userId);
      return ok(await this.present(view));
    } catch (e) {
      return this.refusal(e, httpRequest, userId);
    }
  }

  @Tool({
    name: 'set_user_agent_access',
    topic: ToolTopics.UsersKeys,
    effect: 'write',
    title: "Change a user's agent access",
    template: 'Let «email» use only «agents»',
    destructive: true,
    description:
      'Change which agents a user account reaches. `allow` puts agents on ' +
      'the allowed list: with at least one allowed agent the account ' +
      'reaches ONLY its allowed agents. `deny` puts agents on the denied ' +
      'list: the account never reaches those. `clear` removes an agent ' +
      'from both lists. An agent is on one list at most, so allowing a ' +
      'denied agent moves it. Removing the last allowed agent opens the ' +
      'account to every agent that is not denied. Without confirm: true ' +
      'nothing is changed and the answer says what the access WOULD be: ' +
      'state that to the person, ask, and call again with confirm: true ' +
      'after a yes. The Owner may change Admins and Users; an Admin only ' +
      'Users, only with agents the Admin reaches, and never so that the ' +
      'user reaches an agent the Admin does not. Nobody changes the ' +
      "Owner's access or their own. " +
      CONFIRM_SENTENCE,
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
      allow: idsSchema('to allow'),
      deny: idsSchema('to deny'),
      clear: idsSchema('to take off both lists'),
      confirm: z
        .boolean()
        .optional()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async setUserAgentAccess(
    args: {
      userId: string;
      allow?: string[];
      deny?: string[];
      clear?: string[];
      confirm?: boolean;
    },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { userId, allow, deny, clear } = args;
    const confirmed = args.confirm === true;
    try {
      const result = await this.access.adjust(
        editorOf(httpRequest),
        userId,
        { allow, deny, clear },
        // The person's yes covers opening the account too: the dry run
        // below is where they were told it would.
        { confirmOpen: true, dryRun: !confirmed },
      );
      const access = await this.present(result.view);
      if (!confirmed) {
        return ok({
          changed: false,
          wouldBe: access,
          ...(result.opens
            ? {
                warning:
                  'This account will reach every agent that is not denied.',
              }
            : {}),
          message:
            `Nothing was changed. After this change the account: ` +
            `${access.sentence}. Say that to the person and ask; call ` +
            'again with confirm: true only after a yes.',
        });
      }
      if (result.saved) {
        this.logger.log(`Agent access changed through MCP: user=${userId}`);
      }
      return ok({ changed: result.saved, access });
    } catch (e) {
      return this.refusal(e, httpRequest, userId);
    }
  }

  /** The view with a name next to each id and the outcome as a sentence. */
  private async present(view: IAgentAccessView) {
    const [user, agents] = await Promise.all([
      this.users.findById(view.userId),
      this.agents.findAll(),
    ]);
    const names = new Map(agents.map((a) => [a.id, a.name]));
    const named = (ids: string[]) =>
      ids.map((id) => ({ id, name: names.get(id) ?? null }));
    return {
      userId: view.userId,
      email: user?.email ?? null,
      allowed: named(view.allowed),
      denied: named(view.denied),
      outcome: view.outcome,
      sentence: outcomeSentence(view.outcome),
      needsReview: view.needsReview,
      hasEntriesOutsideView: view.hasEntriesOutsideView,
    };
  }

  /** A refusal of the service as a tool error, in the same sentence. */
  private refusal(
    e: unknown,
    httpRequest: Request,
    userId: string,
  ): ToolResult {
    if (!(e instanceof AgentAccessError)) throw e;
    if (e.code === AgentAccessErrorCodes.UserNotFound) {
      return err(`User ${userId} not found — call list_users to find the id`);
    }
    if (e.code === AgentAccessErrorCodes.AgentNotFound) {
      return err(`${e.message} — ${agentNotFoundAdvice(httpRequest)}`);
    }
    return err(e.message);
  }
}

/**
 * Who is making the change: the party the call is made for. A person keeps
 * their own role and their own reach; the Ranch admin agent acting for
 * itself is trusted, as everywhere.
 */
function editorOf(httpRequest: Request): IAccessEditor {
  const party = callerParty(httpRequest);
  if (party.kind === 'person') return party;
  // `requireOperator` already refused a guest; what is left is trusted.
  return { kind: 'trusted' };
}
