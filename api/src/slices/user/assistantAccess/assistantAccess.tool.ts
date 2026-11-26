import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolAudience, ToolTopics } from '#mcp';
import {
  callerParty,
  CONFIRM_SENTENCE,
  err,
  ok,
  requireOperator,
  requireOwner,
  requirePerson,
  type ToolResult,
} from '#/mcp/tooling';
import { UserRoleTypes } from '#/user/user/domain';
import {
  AssistantAccessError,
  AssistantAccessErrorCodes,
  AssistantAccessService,
  type AssistantRole,
  type IAssistantAccountView,
  type IAssistantEditor,
  type IAssistantLoss,
  type IAssistantSettingInput,
} from './domain';
import { MY_ASSISTANT_ACCESS_TOOL } from './domain/assistantToolPolicy.service';

const levelSchema = z
  .enum(['basic', 'standard', 'full', 'custom'])
  .optional()
  .describe(
    'basic: see and ask. standard: plus day-to-day work on agents. full: ' +
      'everything the role can do in the console. custom: exactly the ' +
      'abilities in `on`.',
  );

const onSchema = z
  .array(z.string())
  .optional()
  .describe(
    'Only with level custom: the ability names to offer (tool names, as ' +
      'get_assistant_access and the console list them).',
  );

const enabledSchema = z
  .boolean()
  .optional()
  .describe('false switches the assistant off; true switches it on.');

const confirmSchema = z
  .boolean()
  .optional()
  .describe('Set true only after the person confirmed in the chat.');

const OWN_AGENTS_ONLY =
  'These are part of the level for agents this person created themselves, ' +
  'and not counted in `areas`. On any other agent they are not included: ' +
  'the Owner can include one by choosing it for this account.';

const WHO_DECIDES =
  'The Owner of this installation decides what the assistant can do for ' +
  'each person.';

/**
 * Who has the Ranch assistant and what it offers them, from the chat
 * (CLEAN-240): everything the console's two cards do, under the same rules,
 * because it is the same service.
 *
 * What is the tools' own: a change that takes abilities away states who
 * loses what and waits for a yes (the API cannot see the chat), and the two
 * tools that explain carry the level definitions, so the assistant explains
 * a level from the installation and never from text it remembers.
 */
@ToolAudience('admin')
@Injectable()
export class AssistantAccessTool {
  private readonly logger = new Logger(AssistantAccessTool.name);

  constructor(private readonly access: AssistantAccessService) {}

  @ToolAudience('owner')
  @Tool({
    name: 'get_assistant_access',
    topic: ToolTopics.UsersKeys,
    effect: 'read',
    title: 'Show who can use the assistant',
    template: 'Show who can use you, and at which level',
    description:
      'Who can use the assistant and for what: whether it is on for Admins ' +
      'and for Users and at which level, how many people follow each, and ' +
      'everybody who differs from their role, with who set it. Also the ' +
      'definitions of the levels (basic, standard, full) for each role, ' +
      'area by area: explain levels from `levels` here, never from memory, ' +
      'because what a level holds changes with the installation.',
    parameters: z.object({}),
  })
  async getAssistantAccess(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOwner(httpRequest);
    try {
      const overview = await this.access.overview(editorOf(httpRequest));
      const row = (role: AssistantRole) => {
        const r = overview.roles[role];
        return {
          enabled: r.enabled,
          level: r.level,
          ...(r.matchesLevel ? { sameAs: r.matchesLevel } : {}),
          offered: r.offered,
          available: r.available,
          accounts: r.accounts,
        };
      };
      return ok({
        assistant: overview.assistant?.name ?? null,
        ownerAlwaysHasEverything: true,
        roles: {
          Admin: row(UserRoleTypes.Admin),
          User: row(UserRoleTypes.User),
        },
        exceptions: overview.exceptions.map((e) => ({
          userId: e.userId,
          name: e.name,
          email: e.email,
          role: e.role,
          enabled: e.resolved.enabled,
          level: e.resolved.level,
          offered: e.resolved.offered,
          available: e.resolved.available,
          setBy: e.updatedBy,
          ...(e.reducedByRole ? { reducedByRole: true } : {}),
        })),
        // Until the Owner has decided about Users: who lost managing their
        // own agents through the chat when Users started on Basic.
        ...(overview.notice ? { usersStartOnBasic: overview.notice } : {}),
        levels: {
          Admin: this.access.levelsFor(UserRoleTypes.Admin),
          User: this.access.levelsFor(UserRoleTypes.User),
        },
      });
    } catch (e) {
      return this.refusal(e);
    }
  }

  @ToolAudience('owner')
  @Tool({
    name: 'set_assistant_role_access',
    topic: ToolTopics.UsersKeys,
    effect: 'write',
    title: 'Set what a role gets from the assistant',
    template: 'Let «Admins or Users» use you at the «level» level',
    destructive: true,
    description:
      'Change what every Admin, or every User, gets from the assistant: ' +
      'switch it on or off, and set a level or a custom pick of abilities. ' +
      'People with their own setting keep it. A change that takes ' +
      'abilities away from anyone is not made without confirm: true — the ' +
      'answer says how many people lose how many abilities, in which ' +
      'areas: state that, ask, and call again with confirm: true after a ' +
      'yes. A change that only gives more is made at once. It applies from ' +
      'each person’s next message. No level gives a role what it cannot do ' +
      'in the console. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      role: z.enum(['Admin', 'User']).describe('The role to set it for'),
      enabled: enabledSchema,
      level: levelSchema,
      on: onSchema,
      confirm: confirmSchema,
    }),
  })
  async setAssistantRoleAccess(
    args: {
      role: 'Admin' | 'User';
      enabled?: boolean;
      level?: IAssistantSettingInput['level'];
      on?: string[];
      confirm?: boolean;
    },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOwner(httpRequest);
    const editor = editorOf(httpRequest);
    const role = args.role as AssistantRole;
    const input = inputOf(args);
    try {
      const loss = await this.access.lossForRole(editor, role, input);
      if (loss.abilities > 0 && args.confirm !== true) {
        return this.askFirst(loss, `${args.role}s`);
      }
      const view = await this.access.setRole(editor, role, input);
      this.logger.log(`Assistant access changed through MCP: role=${role}`);
      return ok({
        changed: true,
        role: {
          enabled: view.enabled,
          level: view.level,
          offered: view.offered,
          available: view.available,
        },
      });
    } catch (e) {
      return this.refusal(e);
    }
  }

  @Tool({
    name: 'get_user_assistant_access',
    topic: ToolTopics.UsersKeys,
    effect: 'read',
    title: 'Show what the assistant offers a user',
    template: 'Show what «email» can do through you',
    description:
      'What one person gets from the assistant: whether it is on, their ' +
      'level, how many abilities that is of what their role could have, ' +
      'and whether it comes from their role or was set for them. The ' +
      'Owner may ask about anyone; an Admin about Users. Takes the user ' +
      'id — list_users turns an email into one.',
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
    }),
  })
  async getUserAssistantAccess(
    { userId }: { userId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    try {
      return ok(
        await this.present(
          await this.access.accountView(editorOf(httpRequest), userId),
        ),
      );
    } catch (e) {
      return this.refusal(e, userId);
    }
  }

  @Tool({
    name: 'set_user_assistant_access',
    topic: ToolTopics.UsersKeys,
    effect: 'write',
    title: 'Set what the assistant offers a user',
    template: 'Let «email» use you at the «level» level',
    destructive: true,
    description:
      'Give one person their own setting for the assistant, instead of ' +
      'their role’s: switch it on or off, and set a level or a custom pick. ' +
      'What is not mentioned stays as they have it now. Taking abilities ' +
      'away is not done without confirm: true — the answer says what they ' +
      'would lose: state that, ask, and call again with confirm: true ' +
      'after a yes. Giving more is done at once. The Owner may set it for ' +
      'Admins and Users; an Admin only for Users, and never more than the ' +
      'assistant offers the Admin. Nobody sets it for the Owner or for ' +
      'themselves. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
      enabled: enabledSchema,
      level: levelSchema,
      on: onSchema,
      confirm: confirmSchema,
    }),
  })
  async setUserAssistantAccess(
    args: {
      userId: string;
      enabled?: boolean;
      level?: IAssistantSettingInput['level'];
      on?: string[];
      confirm?: boolean;
    },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const editor = editorOf(httpRequest);
    const input = inputOf(args);
    try {
      const loss = await this.access.lossForAccount(editor, args.userId, input);
      if (loss.abilities > 0 && args.confirm !== true) {
        return this.askFirst(loss, 'this person');
      }
      const view = await this.access.setAccount(editor, args.userId, input);
      this.logger.log(
        `Assistant access changed through MCP: user=${args.userId}`,
      );
      return ok({ changed: true, access: await this.present(view) });
    } catch (e) {
      return this.refusal(e, args.userId);
    }
  }

  @Tool({
    name: 'reset_user_assistant_access',
    topic: ToolTopics.UsersKeys,
    effect: 'write',
    title: 'Return a user to their role’s assistant setting',
    template: 'Let «email» use you the way their role does again',
    description:
      'Drop the setting made for one person, so they get from the ' +
      'assistant what their role gets. Answers what they have afterwards. ' +
      'The same people may do this as may set it.',
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
    }),
  })
  async resetUserAssistantAccess(
    { userId }: { userId: string },
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    try {
      const view = await this.access.resetAccount(
        editorOf(httpRequest),
        userId,
      );
      return ok({ changed: true, access: await this.present(view) });
    } catch (e) {
      return this.refusal(e, userId);
    }
  }

  @ToolAudience('person')
  @Tool({
    name: MY_ASSISTANT_ACCESS_TOOL,
    topic: ToolTopics.UsersKeys,
    effect: 'read',
    title: 'Show what the assistant can do for me',
    template: 'What can you do for me?',
    description:
      'What the assistant offers the person it is talking to: their level, ' +
      'how much of each area it covers, and what their role could have ' +
      'that was not included for them. Call this BEFORE telling a person ' +
      'you cannot do something: if what they asked for is in ' +
      '`notIncluded`, say that it is not included for them and that the ' +
      'Owner decides — do not say you have no such tool, do not try ' +
      'another way. Also call it when they ask what you can do for them ' +
      'or what their level means, and answer from `levels`. ' +
      '`onlyOnAgentsYouCreated`, when present, lists what their level ' +
      'holds for agents they created themselves and for no other agent: ' +
      'for any other agent treat it as not included, and say the Owner ' +
      'can include it for them. Never describe what other people have.',
    parameters: z.object({}),
  })
  async getMyAssistantAccess(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: Request,
  ): Promise<ToolResult> {
    const person = requirePerson(httpRequest);
    const mine = await this.access.myAccess({ kind: 'person', ...person });
    return ok({
      enabled: mine.enabled,
      level: mine.level,
      ...(mine.matchesLevel ? { sameAs: mine.matchesLevel } : {}),
      areas: mine.areas,
      notIncluded: mine.leftOut.map((a) => ({ title: a.title, area: a.area })),
      // Only when there is something to say: a User on a built-in level.
      ...(mine.ownAgentsOnly.length
        ? {
            onlyOnAgentsYouCreated: mine.ownAgentsOnly.map((a) => ({
              title: a.title,
              area: a.area,
            })),
            onlyOnAgentsYouCreatedNote: OWN_AGENTS_ONLY,
          }
        : {}),
      whoDecides: WHO_DECIDES,
      // Their own role only: what a level means for them.
      levels: this.access.levelsFor(person.role),
    });
  }

  /** Nothing was changed: what it would cost, to say and ask about. */
  private askFirst(loss: IAssistantLoss, who: string): ToolResult {
    const people = loss.accounts === 1 ? '1 person' : `${loss.accounts} people`;
    return ok({
      changed: false,
      wouldLose: loss,
      message:
        `Nothing was changed. This would take ${loss.abilities} ` +
        `${loss.abilities === 1 ? 'ability' : 'abilities'} away from ` +
        `${who} (${people}). Say that to the person and ask; call again ` +
        'with confirm: true only after a yes.',
    });
  }

  /** The view with the person's email next to the id. */
  private async present(view: IAssistantAccountView) {
    return {
      userId: view.userId,
      email: await this.access.emailOf(view.userId),
      role: view.role,
      enabled: view.enabled,
      level: view.level,
      ...(view.matchesLevel ? { sameAs: view.matchesLevel } : {}),
      source: view.source,
      offered: view.offered,
      available: view.available,
      ...(view.pick ? { on: view.pick.on, new: view.pick.new } : {}),
      ...(view.roleSetting
        ? {
            theirRoleGets: {
              enabled: view.roleSetting.enabled,
              level: view.roleSetting.level,
            },
          }
        : {}),
    };
  }

  private refusal(e: unknown, userId?: string): ToolResult {
    if (!(e instanceof AssistantAccessError)) throw e;
    if (e.code === AssistantAccessErrorCodes.UserNotFound) {
      return err(
        `User ${userId ?? ''} not found — call list_users to find the id`,
      );
    }
    return err(
      e.names?.length ? `${e.message} (${e.names.join(', ')})` : e.message,
    );
  }
}

function editorOf(httpRequest: Request): IAssistantEditor {
  const party = callerParty(httpRequest);
  if (party.kind === 'person') return party;
  // The audience lock already refused a guest; what is left is trusted.
  return { kind: 'trusted' };
}

function inputOf(args: {
  enabled?: boolean;
  level?: IAssistantSettingInput['level'];
  on?: string[];
}): IAssistantSettingInput {
  return {
    ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    ...(args.level !== undefined ? { level: args.level } : {}),
    ...(args.on !== undefined ? { on: args.on } : {}),
  };
}
