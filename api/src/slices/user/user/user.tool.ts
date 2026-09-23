import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  err,
  ok,
  requireOperator,
  stripSecrets,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import {
  ASSIGNABLE_USER_ROLES,
  IUserGateway,
  UserRoleTypes,
  type IUpdateUserData,
  type IUserData,
  type UserStatusTypes,
} from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** What `CreateUserDto` / `UpdateUserDto` validate, expressed for the model. */
const nameSchema = z.string().min(2).describe('Display name, at least 2 chars');
const emailSchema = z.string().email().describe('Login email');
const passwordSchema = z
  .string()
  .min(8)
  .describe('Initial password, at least 8 chars — it is never shown again');
const statusSchema = z
  .enum(['active', 'invited', 'disabled'])
  .describe('Account status');
/** Owner is deliberately not assignable — it exists once, created via /init. */
const roleSchema = z
  .enum([UserRoleTypes.Admin, UserRoleTypes.User])
  .describe(`Role to assign: ${ASSIGNABLE_USER_ROLES.join(' or ')}`);

/** Fields that never leave a user row through a tool (FR-004). */
const USER_SECRET_KEYS = ['password', 'passwordHash'] as const;

/**
 * The Users page of the console from the chat (CLEAN-109). Every call goes
 * through `IUserGateway`, the gateway `UserController` injects, so hashing,
 * email normalisation and the role whitelist stay where they are.
 *
 * The controller's rules are mirrored, not re-derived: the Owner account
 * cannot be removed, re-roled or have its status changed, and the role
 * endpoint only accepts Admin or User. Where the controller answers 403 the
 * tool answers with the same sentence plus the next move, because a model
 * that reads a bare "forbidden" wastes a turn guessing why.
 *
 * Passwords go IN through a tool and never come OUT: a result lands in a
 * model's context and from there in a transcript, so rows are stripped of
 * `password` / `passwordHash` even though the gateway's mapper already omits
 * them — the mapper is one refactor away from not doing so.
 *
 * Operator agents only. Role changes and removals are Owner-only in the
 * controller; operator gating already means the Owner role, so the same
 * caller reaches both.
 */
@Injectable()
export class UserTool implements IConditionallyListedTool {
  private readonly logger = new Logger(UserTool.name);

  constructor(private readonly users: IUserGateway) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'list_users',
    topic: ToolTopics.UsersKeys,
    title: 'List users',
    template: 'List the users of this Ranch',
    description:
      'Every user account of this Ranch: id, name, email, role and status. ' +
      'Never a password. Read this to turn an email the person said into ' +
      'the id the other user tools take.',
  })
  async listUsers(
    _args: Record<string, never>,
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const rows = await this.users.findAll();
    return ok({ users: rows.map(publicUser) });
  }

  @Tool({
    name: 'get_user',
    topic: ToolTopics.UsersKeys,
    title: 'Show a user',
    template: 'Show the user «email»',
    description:
      'One user account by id: name, email, role, status and timestamps, ' +
      'never a password. Takes the user id — list_users turns an email into ' +
      'one.',
    parameters: z.object({
      userId: z.string().describe('User id, e.g. user-… (list_users has them)'),
    }),
  })
  async getUser(
    { userId }: { userId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const user = await this.users.findById(userId);
    if (!user) return notFound(userId);
    return ok(publicUser(user));
  }

  @Tool({
    name: 'create_user',
    topic: ToolTopics.UsersKeys,
    title: 'Create a user',
    template: 'Create a user «name» with email «email» and password «password»',
    description:
      'Create a user account with the password the person chose, as the ' +
      'console does (there is no invitation email). Role defaults to User; ' +
      'Admin is the other option — Owner exists once and cannot be created. ' +
      'The result is the new account without the password; the person must ' +
      'pass it on themselves, it is never shown again.',
    parameters: z.object({
      name: nameSchema,
      email: emailSchema,
      password: passwordSchema,
      role: roleSchema.optional(),
    }),
  })
  async createUser(
    {
      name,
      email,
      password,
      role,
    }: { name: string; email: string; password: string; role?: UserRoleTypes },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const user = await this.users.create({ name, email, password, role });
    // Log who was created, never with what — the API log is not a vault.
    this.logger.log(`User created through MCP: id=${user.id} email=${email}`);
    return ok({
      ok: true,
      user: publicUser(user),
      note: 'The password is not repeated here; the person hands it over.',
    });
  }

  @Tool({
    name: 'update_user',
    topic: ToolTopics.UsersKeys,
    title: 'Update a user',
    template: 'Change the user «email»: «what to change»',
    description:
      "Change a user's name, email, password or status (active, invited, " +
      'disabled). Pass only the fields to change. The role is not changed ' +
      'here — use set_user_role. The Owner account cannot be disabled or ' +
      'otherwise re-statused. Returns the updated account, never a password.',
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
      name: nameSchema.optional(),
      email: emailSchema.optional(),
      password: passwordSchema.optional().describe('New password, 8+ chars'),
      status: statusSchema.optional(),
    }),
  })
  async updateUser(
    {
      userId,
      name,
      email,
      password,
      status,
    }: {
      userId: string;
      name?: string;
      email?: string;
      password?: string;
      status?: UserStatusTypes;
    },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const target = await this.users.findById(userId);
    if (!target) return notFound(userId);
    // Same rule as UserController.update: the Owner's status is not for
    // changing, since a disabled Owner locks the Ranch.
    if (status !== undefined && target.role === UserRoleTypes.Owner) {
      return err(
        'The Owner account status cannot be changed. Its name, email or ' +
          'password can — call again without status.',
      );
    }
    const patch: IUpdateUserData = {
      ...(name !== undefined && { name }),
      ...(email !== undefined && { email }),
      ...(password !== undefined && { password }),
      ...(status !== undefined && { status }),
    };
    if (Object.keys(patch).length === 0) {
      return err(
        'Nothing to change — pass at least one of name, email, password, status.',
      );
    }
    const user = await this.users.update(userId, patch);
    this.logger.log(
      `User updated through MCP: id=${userId} fields=${Object.keys(patch).join(',')}`,
    );
    return ok({ ok: true, user: publicUser(user) });
  }

  @Tool({
    name: 'set_user_role',
    topic: ToolTopics.UsersKeys,
    title: "Set a user's role",
    template: 'Make «email» an «admin|user»',
    destructive: true,
    description:
      "Change a user's role to Admin or User. Owner is not assignable: it " +
      'exists once and the Owner account itself cannot be re-roled. Demoting ' +
      'an Admin to User takes away their console access to agents and ' +
      'users, so it counts as destructive. Takes the user id (list_users). ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
      role: roleSchema,
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async setUserRole(
    args: { userId: string; role: UserRoleTypes; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { userId, role } = args;
    const target = await this.users.findById(userId);
    if (!target) return notFound(userId);
    // Same rule as UserController.updateRole (Owner-only there; the operator
    // gate above is the same lock).
    if (target.role === UserRoleTypes.Owner) {
      return err(
        `The Owner role cannot be changed — «${target.email}» stays Owner.`,
      );
    }
    if (!(ASSIGNABLE_USER_ROLES as readonly string[]).includes(role)) {
      return err(
        `Role must be one of ${ASSIGNABLE_USER_ROLES.join(', ')}; Owner is not assignable.`,
      );
    }
    if (target.role === role) {
      return ok({
        ok: true,
        user: publicUser(target),
        note: `«${target.email}» already has the role ${role}; nothing changed.`,
      });
    }
    const refusal = confirmed(
      args,
      `make «${target.email}» a ${role} (currently ${target.role})`,
    );
    if (refusal) return refusal;
    const user = await this.users.update(userId, { role });
    this.logger.log(
      `User role set through MCP: id=${userId} ${target.role}->${role}`,
    );
    return ok({ ok: true, user: publicUser(user) });
  }

  @Tool({
    name: 'delete_user',
    topic: ToolTopics.UsersKeys,
    title: 'Remove a user',
    template: 'Remove the user «email»',
    destructive: true,
    description:
      'Remove a user account for good: their sessions stop working and the ' +
      'row is gone — there is no undo, only creating them again. The Owner ' +
      'account cannot be removed. Takes the user id (list_users). ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      userId: z.string().describe('User id (list_users has them)'),
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteUser(
    args: { userId: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { userId } = args;
    const target = await this.users.findById(userId);
    if (!target) return notFound(userId);
    // Same rule as UserController.remove: the Owner is the one account a
    // Ranch cannot be without.
    if (target.role === UserRoleTypes.Owner) {
      return err(
        `The Owner account cannot be removed — «${target.email}» stays.`,
      );
    }
    const refusal = confirmed(
      args,
      `remove the user «${target.email}» (${target.name}, ${target.role}) — this cannot be undone`,
    );
    if (refusal) return refusal;
    await this.users.delete(userId);
    this.logger.log(`User removed through MCP: id=${userId}`);
    return ok({
      ok: true,
      removed: { id: target.id, email: target.email, name: target.name },
    });
  }
}

/**
 * The row as the console shows it. `IUserData` carries no password today;
 * the strip is there so a mapper change can never turn a listing into a
 * hash dump (FR-004).
 */
function publicUser(user: IUserData) {
  return stripSecrets(user, USER_SECRET_KEYS);
}

function notFound(userId: string): ToolResult {
  return ok({
    error: `User ${userId} not found — call list_users to find the id`,
  });
}
