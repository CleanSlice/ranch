import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import {
  highestPersonRole,
  type IAuthTokenPayload,
  type ICallerParty,
} from '#/user/auth/domain/auth.types';
import { ROLE_LEVELS, UserRoleTypes } from '#/user/user/domain';
import type { ToolAudienceTypes } from './decorators/tool-audience.decorator';

/**
 * Shared helpers for every `*.tool.ts` (CLEAN-109). One vocabulary for what a
 * tool hands back, who is calling, and how a destructive tool asks for a
 * confirmation it cannot see for itself. `agent/peer/toolSupport.ts` re-exports
 * the shared part so the peer tools read exactly as before.
 *
 * "Who is calling" has two halves since CLEAN-232: the token of the request
 * and the party the call is made for. See `callerParty` and `audienceAllows`.
 */

/** What an MCP tool hands back. The shape the SDK expects, nothing more. */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export const ok = (value: unknown): ToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

export const err = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/**
 * Agent service tokens carry `sub = agent:<id>`; anything else is not an
 * agent. Read from the token alone, whoever the call is made for: the
 * self-service tools act for the calling agent.
 */
export function callerAgentId(httpRequest: Request): string | null {
  const user = (httpRequest as AuthedRequest).user;
  const sub = user?.sub ?? '';
  if (!sub.startsWith('agent:')) return null;
  return sub.slice('agent:'.length);
}

// ── Who the call is made for (CLEAN-232) ─────────────────────
//
// An agent's token says what the agent may do at most. It does not say for
// whom: the Ranch admin agent's token carries Owner, and it answers a plain
// User as readily as the Owner. So a tool call is made *for a party*
// (`ICallerParty`), and every question below is answered with the lesser of
// the token's power and the party's.

const PARTY_PROPERTY = 'ranchParty';
const GUEST: ICallerParty = { kind: 'guest' };

const OWNER_LEVEL = ROLE_LEVELS[UserRoleTypes.Owner];
const ADMIN_LEVEL = ROLE_LEVELS[UserRoleTypes.Admin];

function isCallerParty(value: unknown): value is ICallerParty {
  if (typeof value !== 'object' || value === null) return false;
  const party = value as { kind?: unknown; userId?: unknown; role?: unknown };
  if (party.kind === 'trusted' || party.kind === 'guest') return true;
  return (
    party.kind === 'person' &&
    typeof party.userId === 'string' &&
    party.userId.length > 0 &&
    typeof party.role === 'string' &&
    Object.prototype.hasOwnProperty.call(ROLE_LEVELS, party.role)
  );
}

/**
 * Attach the resolved party to the request object a tool receives. The MCP
 * handler does this once per call, on a per-call view of the HTTP request
 * (`withCallerParty`), never on the shared request itself. Not enumerable, so
 * it does not travel when a request is spread or logged.
 */
export function setCallerParty(
  httpRequest: Request,
  party: ICallerParty,
): void {
  Object.defineProperty(httpRequest, PARTY_PROPERTY, {
    value: party,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * A per-call view of `httpRequest` carrying `party`. One MCP session serves
 * many calls, possibly at once and for different people, through the same
 * transport request; a view keeps one call's party from leaking into
 * another. Everything else (`user`, headers) is read through to the request.
 */
export function withCallerParty(
  httpRequest: Request,
  party: ICallerParty,
): Request {
  const view = Object.create(httpRequest ?? null) as Request;
  setCallerParty(view, party);
  return view;
}

/**
 * The party this call is made for. When none was attached: a person's own
 * console token speaks for that person, and an agent's token for nobody,
 * which is a guest. Failing closed is the point: an agent runtime that names
 * no actor gets no management power.
 */
export function callerParty(httpRequest: Request): ICallerParty {
  const stashed = (httpRequest as unknown as Record<string, unknown> | null)?.[
    PARTY_PROPERTY
  ];
  if (isCallerParty(stashed)) return stashed;

  const user = (httpRequest as AuthedRequest | null)?.user;
  const sub = typeof user?.sub === 'string' ? user.sub : '';
  if (!sub || sub.startsWith('agent:')) return GUEST;
  const role = highestPersonRole(user?.roles);
  return role ? { kind: 'person', userId: sub, role } : GUEST;
}

/** What the bearer may do at most: Owner 3, Admin 2, User 1, anything else 0. */
function tokenLevel(httpRequest: Request): number {
  const role = highestPersonRole(
    (httpRequest as AuthedRequest | null)?.user?.roles,
  );
  return role ? ROLE_LEVELS[role] : 0;
}

function partyLevel(party: ICallerParty): number {
  if (party.kind === 'trusted') return OWNER_LEVEL;
  if (party.kind === 'person') return ROLE_LEVELS[party.role] ?? 0;
  return 0;
}

/**
 * The power this call has: the lesser of the token's and the party's. The
 * party never raises what the token allows (a plain agent stays a plain
 * agent whoever it names), and the token never raises what the party may do
 * (the Ranch admin agent answering a User is a User).
 */
export function callerLevel(httpRequest: Request): number {
  return Math.min(
    tokenLevel(httpRequest),
    partyLevel(callerParty(httpRequest)),
  );
}

/** The `admin` audience: an Owner or Admin, or an agent trusted to act as one. */
export function callerIsOperator(httpRequest: Request): boolean {
  return callerLevel(httpRequest) >= ADMIN_LEVEL;
}

/** The `owner` audience: the Owner, or an agent trusted to act as one. */
export function callerIsOwner(httpRequest: Request): boolean {
  return callerLevel(httpRequest) >= OWNER_LEVEL;
}

/**
 * The person this call is made for, whatever the bearer: a plain agent
 * acting for a proven person may use `person` tools. Null for a trusted
 * party and for a guest.
 */
export function callerPerson(
  httpRequest: Request,
): { userId: string; role: UserRoleTypes } | null {
  const party = callerParty(httpRequest);
  return party.kind === 'person'
    ? { userId: party.userId, role: party.role }
    : null;
}

// ── Who may manage an agent (CLEAN-232, contract section 5) ──

const MANAGES_PROPERTY = 'ranchManagesAgents';

/** An agent runtime's token that does not carry operator power. */
function isPlainAgentToken(httpRequest: Request): boolean {
  return (
    callerAgentId(httpRequest) !== null && tokenLevel(httpRequest) < ADMIN_LEVEL
  );
}

/**
 * Record whether the person this call is made for manages at least one
 * agent. The MCP handler asks the agent slice once per call, for a person
 * below Admin only, and writes the answer on the same per-call view the
 * party sits on. Not enumerable, like the party.
 */
export function setCallerManagesAgents(
  httpRequest: Request,
  manages: boolean,
): void {
  Object.defineProperty(httpRequest, MANAGES_PROPERTY, {
    value: manages === true,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * The `manage-agent` audience: a caller who may manage at least one agent.
 * An operator always; otherwise a person the handler found to have created
 * an agent. Bounded by the token like everything else here: a plain agent
 * naming such a person still lists nothing, only the person's own console
 * token or an agent trusted with operator power carries it.
 *
 * This lists the tools. Which agent a call may touch is a second question,
 * answered per call by `AgentPermissionService` with `manageCaller`.
 */
export function callerManagesAgents(httpRequest: Request): boolean {
  if (callerIsOperator(httpRequest)) return true;
  if (callerPerson(httpRequest) === null) return false;
  if (isPlainAgentToken(httpRequest)) return false;
  return (
    (httpRequest as unknown as Record<string, unknown> | null)?.[
      MANAGES_PROPERTY
    ] === true
  );
}

/**
 * The caller as `AgentPermissionService.canManage` reads it: the party the
 * call is made for, bounded by the token. A plain agent's token manages
 * nothing whoever it names, so it is a guest here; the Ranch admin agent
 * acting for itself stays trusted; a person stays that person.
 */
export function manageCaller(httpRequest: Request): ICallerParty {
  if (isPlainAgentToken(httpRequest)) return GUEST;
  return callerParty(httpRequest);
}

/**
 * The single answer to "may this caller use a tool of that audience". The
 * catalogue, tools/call and the listing hooks all ask here. An audience
 * nobody declared allows nobody.
 */
export function audienceAllows(
  audience: ToolAudienceTypes | undefined,
  httpRequest: Request,
): boolean {
  switch (audience) {
    case 'everyone':
      return true;
    case 'agent':
      return callerAgentId(httpRequest) !== null;
    case 'person':
      return callerPerson(httpRequest) !== null;
    case 'reader':
      return (
        callerPerson(httpRequest) !== null || callerIsOperator(httpRequest)
      );
    case 'manage-agent':
      return callerManagesAgents(httpRequest);
    case 'admin':
      return callerIsOperator(httpRequest);
    case 'owner':
      return callerIsOwner(httpRequest);
    default:
      return false;
  }
}

// ── An agent the caller cannot be shown (CLEAN-232) ─────────
//
// A refusal names the next move, and the next move must be one the caller
// has. `list_agents` is a `reader` tool since CLEAN-231: every signed-in
// person has it and gets the agents they reach from it. A caller that is
// nobody (a guest, an agent acting for itself without operator power) does
// not, and a refusal that sent them there would advertise a tool they
// cannot call and send the model looking for it.

/** What to try next after an agent was not found; the half after the dash. */
export function agentNotFoundAdvice(httpRequest: Request): string {
  return callerIsOperator(httpRequest) || callerPerson(httpRequest) !== null
    ? 'call list_agents to find the id'
    : 'there is no such agent for this caller';
}

/**
 * The one sentence every tool answers for an agent that does not exist or is
 * out of the caller's reach. The two read the same on purpose: which agents
 * exist is not for a caller who cannot manage them.
 */
export function agentNotFoundText(httpRequest: Request, ref: string): string {
  return `Agent ${ref} not found — ${agentNotFoundAdvice(httpRequest)}`;
}

/** `agentNotFoundText` as the result a tool hands back. */
export function agentNotFound(httpRequest: Request, ref: string): ToolResult {
  return ok({ error: agentNotFoundText(httpRequest, ref) });
}

/** A person, or an agent acting for itself, who lacks the role. */
export const OPERATOR_REFUSAL =
  'This tool requires the Ranch operator role. Ask the operator to do it ' +
  'in the console, or through the Ranch admin agent.';

/** Nobody is signed in behind this call. */
export const GUEST_REFUSAL = 'This needs a signed-in administrator.';

export const PERSON_REFUSAL = 'This needs a signed-in person.';

function refuseBelow(httpRequest: Request): never {
  throw new ForbiddenException(
    callerParty(httpRequest).kind === 'guest'
      ? GUEST_REFUSAL
      : OPERATOR_REFUSAL,
  );
}

/**
 * Third lock for `admin` tools: the audience hides them from the list and
 * tools/call refuses a name that stopped applying, this refuses the body.
 */
export function requireOperator(httpRequest: Request): void {
  if (!callerIsOperator(httpRequest)) refuseBelow(httpRequest);
}

/** Third lock for `owner` tools. */
export function requireOwner(httpRequest: Request): void {
  if (!callerIsOwner(httpRequest)) refuseBelow(httpRequest);
}

/** Third lock for `person` tools; hands back who the call is for. */
export function requirePerson(httpRequest: Request): {
  userId: string;
  role: UserRoleTypes;
} {
  const person = callerPerson(httpRequest);
  if (!person) throw new ForbiddenException(PERSON_REFUSAL);
  return person;
}

/**
 * Third lock for `reader` tools (`list_agents`, `get_agent`): a signed-in
 * person of any role, or an operator. A guest is refused.
 */
export function requirePersonOrOperator(httpRequest: Request): void {
  if (callerPerson(httpRequest) !== null) return;
  if (callerIsOperator(httpRequest)) return;
  throw new ForbiddenException(PERSON_REFUSAL);
}

export const AGENT_ONLY_REFUSAL =
  'This tool can only be called by an agent runtime.';

/** Self-service tools act for the calling agent; a person has no "self" here. */
export function requireAgent(httpRequest: Request): string {
  const agentId = callerAgentId(httpRequest);
  if (!agentId) throw new ForbiddenException(AGENT_ONLY_REFUSAL);
  return agentId;
}

export const CONFIRM_SENTENCE =
  'Ask the person to confirm first; call only after they said yes, with confirm: true.';

/**
 * The API cannot see the chat, so a destructive tool proves the person agreed
 * with a required `confirm: true`. Returns the refusal to hand back, or null
 * when the call may proceed. `what` is what the tool is about to do, in the
 * words the person would read: "delete agent «support-bot» and its workspace".
 */
export function confirmed(
  args: { confirm?: unknown },
  what: string,
): ToolResult | null {
  if (args.confirm === true) return null;
  return err(
    `This will ${what}. Ask the person to confirm, then call again with confirm: true.`,
  );
}

const SECRET_KEYS = [
  'apiKey',
  'authValue',
  'oauthClientId',
  'clientSecret',
  'password',
  'passwordHash',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'keyHash',
  'cookies',
  'privateKey',
  'value',
] as const;

const DEFAULT_SECRET_KEYS: readonly string[] = SECRET_KEYS.filter(
  (k) => k !== 'value',
);

/**
 * Strip secret-bearing fields from a value before it becomes tool output
 * (FR-004). Recurses into arrays and plain objects. The default set (every
 * name Ranch uses for a credential) is ALWAYS stripped; `extraKeys` adds
 * more for a slice's own field names. `value` is only stripped when asked
 * for, since most rows have an innocent `value`.
 */
export function stripSecrets<T>(
  input: T,
  extraKeys: readonly string[] = [],
): T {
  const keys = new Set<string>([...DEFAULT_SECRET_KEYS, ...extraKeys]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (keys.has(key)) continue;
        out[key] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
}
