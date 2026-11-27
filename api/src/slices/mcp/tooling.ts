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
  const party = value as {
    kind?: unknown;
    userId?: unknown;
    role?: unknown;
    chain?: unknown;
    connectionId?: unknown;
    forUserId?: unknown;
  };
  if (party.kind === 'trusted' || party.kind === 'guest') return true;
  if (party.kind === 'peer') {
    return (
      Array.isArray(party.chain) &&
      party.chain.every((id) => typeof id === 'string') &&
      typeof party.connectionId === 'string' &&
      party.connectionId.length > 0 &&
      (party.forUserId === undefined ||
        (typeof party.forUserId === 'string' && party.forUserId.length > 0))
    );
  }
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

/**
 * A guest and a peer are both nobody here. A colleague's question arrives
 * with the name of the person its chain was started for, and that name
 * decides whom the agent may ask next, never what it may do (CLEAN-236): a
 * question written by another agent's model must not run with the Owner's
 * power because the Owner asked that agent something.
 */
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

// ── Which conversation the call belongs to (CLEAN-236) ──────

const TURN_CLIENT_PROPERTY = 'ranchTurnClient';

/**
 * Note the hub client the runtime says this call's turn belongs to
 * (`_meta["ranch/turn"].client`). The MCP handler does this on the per-call
 * view. It is a routing hint and nothing else: `ask_agent` uses it to show
 * its progress step in the conversation that asked, and the hub ignores a
 * client that has no running turn with the calling agent.
 */
export function setCallerTurnClient(
  httpRequest: Request,
  client: string,
): void {
  Object.defineProperty(httpRequest, TURN_CLIENT_PROPERTY, {
    value: client,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/** The hub client of the turn this call belongs to, when the runtime said. */
export function callerTurnClient(httpRequest: Request): string | null {
  const client = (httpRequest as unknown as Record<string, unknown> | null)?.[
    TURN_CLIENT_PROPERTY
  ];
  return typeof client === 'string' && client ? client : null;
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
 *
 * A person who manages nothing may still hold single tools of this audience
 * through the assistant setting: see `callerGrantedTool` below.
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

// ── What the assistant setting gave a person (CLEAN-254) ────
//
// The Owner, or an Admin, may tick agent abilities for a person in a custom
// pick of the assistant setting (CLEAN-240). Such an ability works through
// the assistant on every agent that person reaches, whoever created it, and
// never on the Ranch admin agent. A built-in level opens nothing this way. Two facts carry that, both noted by the MCP handler on
// the per-call view and never taken from the runtime or the model:
//
//  - the `manage-agent` tool names ticked in the person's custom pick, when
//    the call carries the assistant's own token (`setCallerAssistantGrant`);
//  - the name of the tool this call runs (`setCalledTool`).
//
// A grant is always about one tool. Holding `restart_agent` lists and runs
// `restart_agent`; it says nothing about `delete_agent`.

const GRANT_PROPERTY = 'ranchAssistantGrant';
const CALLED_TOOL_PROPERTY = 'ranchCalledTool';

/**
 * Note the `manage-agent` tools the assistant setting gives the person this
 * call is made for. The handler asks the assistantAccess slice once per
 * call, for a person below Admin talking through an agent, and keeps the
 * names whose audience is `manage-agent`. Not enumerable, like the party.
 */
export function setCallerAssistantGrant(
  httpRequest: Request,
  names: Iterable<string>,
): void {
  Object.defineProperty(httpRequest, GRANT_PROPERTY, {
    value: new Set(names),
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

/**
 * The noted names, for the only caller they can mean anything to: a person,
 * named by an agent's token that carries operator power. The handler noted
 * them for the assistant alone; this is the token's bound on top, the same
 * one `callerManagesAgents` applies.
 */
function assistantGrant(httpRequest: Request): ReadonlySet<string> | null {
  if (callerPerson(httpRequest) === null) return null;
  if (callerAgentId(httpRequest) === null) return null;
  if (isPlainAgentToken(httpRequest)) return null;
  const noted = (httpRequest as unknown as Record<string, unknown> | null)?.[
    GRANT_PROPERTY
  ];
  return noted instanceof Set ? (noted as ReadonlySet<string>) : null;
}

/**
 * Whether the assistant setting gives the person this call is made for the
 * `manage-agent` tool `toolName`. False for any other agent, a person's own
 * console token, a guest, a switched-off setting, and a tool the setting
 * does not hold.
 */
export function callerGrantedTool(
  httpRequest: Request,
  toolName: string | null | undefined,
): boolean {
  if (typeof toolName !== 'string' || !toolName) return false;
  return assistantGrant(httpRequest)?.has(toolName) === true;
}

/**
 * What a tool class that only holds `manage-agent` tools answers its listing
 * hook with: the caller manages an agent, or the assistant setting gave them
 * at least one such tool. Which tools is not asked here: `audienceAllows`
 * has already decided that for the tool at hand, by name.
 */
export function callerHoldsManageTools(httpRequest: Request): boolean {
  if (callerManagesAgents(httpRequest)) return true;
  return (assistantGrant(httpRequest)?.size ?? 0) > 0;
}

/**
 * Note which tool this call runs. The handler does this on tools/call, on
 * the per-call view, with the name it looked the tool up by.
 */
export function setCalledTool(httpRequest: Request, toolName: string): void {
  Object.defineProperty(httpRequest, CALLED_TOOL_PROPERTY, {
    value: toolName,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function calledTool(httpRequest: Request): string | null {
  const name = (httpRequest as unknown as Record<string, unknown> | null)?.[
    CALLED_TOOL_PROPERTY
  ];
  return typeof name === 'string' && name ? name : null;
}

/**
 * The caller as `AgentPermissionService.canManage` reads it: the party the
 * call is made for, bounded by the token. A plain agent's token manages
 * nothing whoever it names, so it is a guest here; the Ranch admin agent
 * acting for itself stays trusted; a person stays that person.
 *
 * A person is rebuilt here from who they are, so `grantedThroughAssistant`
 * is on the result for one reason only: the tool this call runs is one the
 * assistant setting gave them (CLEAN-254). Whatever a party arrived with is
 * dropped.
 */
export function manageCaller(httpRequest: Request): ICallerParty {
  if (isPlainAgentToken(httpRequest)) return GUEST;
  const party = callerParty(httpRequest);
  if (party.kind !== 'person') return party;
  const person: ICallerParty = {
    kind: 'person',
    userId: party.userId,
    role: party.role,
  };
  return callerGrantedTool(httpRequest, calledTool(httpRequest))
    ? { ...person, grantedThroughAssistant: true }
    : person;
}

/**
 * Whether this caller manages `agent` for one reason only: the assistant
 * setting gave them the tool being called (CLEAN-254). Asked after
 * `manageable` let the call through. An operator got there by role and the
 * creator by having made the agent; anybody else below Admin got there by
 * the grant.
 *
 * Such a person is not an operator. They may do to the agent what the tool
 * is named for, and no more: nothing that binds it to a resource they have
 * no route to (a model credential, a knowledge base, a bot, an outside
 * address), and nothing in the reply that the reader view keeps from them.
 * Those parts of a tool ask here, and refuse with `operatorOnly`.
 */
export function managesByGrantOnly(
  httpRequest: Request,
  agent: { createdById?: string | null },
): boolean {
  if (callerIsOperator(httpRequest)) return false;
  const person = callerPerson(httpRequest);
  if (!person) return false;
  return !agent.createdById || agent.createdById !== person.userId;
}

/**
 * The refusal for a part of a `manage-agent` tool that stays an operator's,
 * or null when this caller may use it. `what` is the part, as the person
 * would read it: "Changing the model credential (llmCredentialId)".
 */
export function operatorOnly(
  httpRequest: Request,
  agent: { createdById?: string | null },
  what: string,
): ToolResult | null {
  if (!managesByGrantOnly(httpRequest, agent)) return null;
  return err(
    `${what} is for an Owner or Admin, and is not part of what was ` +
      'included for this account. Nothing was done. Say so to the ' +
      'person in one sentence; do not try it another way.',
  );
}

/**
 * The `manage-agent` tools that refuse with `operatorOnly` before doing
 * anything at all, as opposed to those that refuse one argument or shorten
 * a reply. For a person below Admin each of these works on agents they
 * created and on no other, whether or not it was ticked for them, and the
 * console that hands abilities out says so beside each (CLEAN-257).
 *
 * A tool that starts refusing whole this way is added here in the same
 * change.
 */
export const CREATOR_OR_OPERATOR_TOOLS: ReadonlySet<string> = new Set([
  'get_agent_env',
  'get_agent_logs',
  'import_agent_from_card',
  'import_external_agent',
  'list_agent_mcps',
  'set_agent_channels',
  'set_agent_visibility',
]);

/**
 * The single answer to "may this caller use a tool of that audience". The
 * catalogue, tools/call and the listing hooks all ask here. An audience
 * nobody declared allows nobody.
 *
 * `toolName` matters to `manage-agent` alone: a person who manages no agent
 * still has the tools of that audience their assistant setting holds, one
 * by one (CLEAN-254). Asked without a name, only managing an agent counts.
 */
export function audienceAllows(
  audience: ToolAudienceTypes | undefined,
  httpRequest: Request,
  toolName?: string,
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
      return (
        callerManagesAgents(httpRequest) ||
        callerGrantedTool(httpRequest, toolName)
      );
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

/**
 * `agentNotFoundText` as the result a tool hands back.
 *
 * One exception, decided here so that every tool has it (CLEAN-263): the
 * Ranch assistant, named by a person who is talking to it and is not the
 * Owner. See `ownerOnlyRefusal`.
 *
 * `kind` is what the tool was asked to do with the agent, and so what the
 * refusal says only the Owner can do. A `manage-agent` tool leaves it out;
 * a tool that reads the conversations people had with an agent passes
 * `'conversations'` (CLEAN-267).
 */
export function agentNotFound(
  httpRequest: Request,
  ref: string,
  kind: OwnerOnlyKindTypes = 'manage',
): ToolResult {
  return (
    ownerOnlyRefusal(httpRequest, ref, kind) ??
    ok({ error: agentNotFoundText(httpRequest, ref) })
  );
}

// ── The agent that is the Owner's alone (CLEAN-263) ─────────
//
// The Ranch admin agent is the assistant every person talks to, and only the
// Owner manages it. A person who reaches it is shown it by `list_agents`, so
// "not found, call list_agents" for its id is a lie about an agent they are
// looking at, and the model made a story of it: a fault, cause unknown, try
// later. For that one agent and that one caller the refusal says what is
// true. For everybody and everything else not-found stays as it was: an
// agent out of reach, the assistant switched off for the person, an id that
// names nothing.
//
// Whether the caller is such a person is a fact about roles and reach, which
// the agent slice knows. The MCP handler asks it once per call
// (`AGENT_MANAGER_RESOLVER.ownerOnlyAgentFor`) and notes the answer on the
// call's view, like the party. Nothing is noted for the Owner, for a trusted
// party, for a guest, or for a person who does not reach the assistant, so
// for them there is nothing to tell apart.
//
// The same is true of its conversations (CLEAN-267). They are the Owner's
// alone to read, and the chat tools left the assistant out as an agent that
// does not exist. Asked by an Admin for "the assistant's conversations", the
// model got "not found", went looking another way, found a chat of another
// agent under the same participant id and presented it as the assistant's;
// then said the assistant had none. So a refusal has a kind: what the tool
// was asked to do, which is what the sentence says only the Owner can do.
// One sentence per kind of thing, never one per tool.

const OWNER_ONLY_PROPERTY = 'ranchOwnerOnlyAgent';

/**
 * What a tool was asked to do with the Ranch assistant:
 *
 *  - `manage`: restart, stop or change it. What a `manage-agent` tool does,
 *    and the kind `agentNotFound` assumes.
 *  - `conversations`: read, replay, summarise, export or reindex what people
 *    said to it.
 */
export type OwnerOnlyKindTypes = 'manage' | 'conversations';

/** The half of the sentence after "Only the Owner can". */
const OWNER_ONLY_CAN: Record<OwnerOnlyKindTypes, string> = {
  manage: 'restart, stop or change it',
  conversations: 'read its conversations',
};

/** The Ranch assistant, as much of it as a refusal may say. */
export interface IOwnerOnlyAgent {
  id: string;
  name: string;
}

/** What `reason` holds in an owner-only refusal; the model reads it. */
export const OWNER_ONLY_REASON = 'owner_only';

/** What a row of `list_agents` / `get_agent` carries for such an agent. */
export const OWNER_MANAGED_MARK = 'owner';

/**
 * One sentence for the description of a tool that restarts, stops or changes
 * an agent, so that the attempt is not made in the first place.
 */
export const OWNER_MANAGED_NOTE =
  'An agent that list_agents marks `managedBy: "owner"` is the Ranch ' +
  'assistant: only the Owner can restart, stop or change it, so do not ' +
  'call this for it on behalf of anybody else.';

/**
 * Note the agent this caller reaches and may not manage because it is the
 * Owner's alone. The handler does this on every tools/call, on the per-call
 * view. Not enumerable, like the party.
 *
 * `managing` says whether the tool being called manages an agent, which is
 * the handler's to know (the audience `manage-agent`). Only then does a
 * refusal of the kind `manage` name the Owner: an `admin` tool that reads an
 * agent by id and was handed the assistant's name where an id belongs must
 * keep saying "not found, call list_agents", because the Admin may read it
 * and "only the Owner can restart, stop or change it" would answer a
 * question nobody asked. A tool that names its own kind is answered whatever
 * its audience.
 */
export function setCallerOwnerOnlyAgent(
  httpRequest: Request,
  agent: IOwnerOnlyAgent | null,
  managing = true,
): void {
  Object.defineProperty(httpRequest, OWNER_ONLY_PROPERTY, {
    value:
      agent && typeof agent.id === 'string' && agent.id
        ? {
            id: agent.id,
            name: String(agent.name ?? ''),
            managing: managing === true,
          }
        : null,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function ownerOnlyAgent(
  httpRequest: Request,
): (IOwnerOnlyAgent & { managing: boolean }) | null {
  const noted = (httpRequest as unknown as Record<string, unknown> | null)?.[
    OWNER_ONLY_PROPERTY
  ];
  if (typeof noted !== 'object' || noted === null) return null;
  const { id, name, managing } = noted as {
    id?: unknown;
    name?: unknown;
    managing?: unknown;
  };
  return typeof id === 'string' && id
    ? {
        id,
        name: typeof name === 'string' ? name : '',
        managing: managing === true,
      }
    : null;
}

/**
 * The whole refusal. Nothing follows it on purpose: no next move, no other
 * id, no "later". There is none for this person.
 */
export function ownerOnlyText(
  name: string,
  kind: OwnerOnlyKindTypes = 'manage',
): string {
  return (
    `${name.trim() || 'This agent'} is the Ranch assistant. ` +
    `Only the Owner can ${OWNER_ONLY_CAN[kind]}.`
  );
}

/**
 * The refusal for `ref` when it names the agent noted for this call, by id
 * or by its exact name (case and outer spaces aside, as the tools that take
 * a name read one); null for anything else, which is then not found.
 *
 * `agentNotFound` asks here, so a tool that answers with it needs nothing
 * more. A tool with a "not found" of its own (the connection tools, a chat
 * tool handed the id of a chat) asks here first.
 *
 * `kind` as in `agentNotFound`. The kind `manage` is answered on a call of
 * a `manage-agent` tool only (see `setCallerOwnerOnlyAgent`).
 */
export function ownerOnlyRefusal(
  httpRequest: Request,
  ref: string,
  kind: OwnerOnlyKindTypes = 'manage',
): ToolResult | null {
  const agent = ownerOnlyAgent(httpRequest);
  if (!agent || typeof ref !== 'string') return null;
  if (kind === 'manage' && !agent.managing) return null;
  const wanted = ref.trim().toLowerCase();
  const named =
    ref === agent.id ||
    (wanted !== '' && wanted === agent.name.trim().toLowerCase());
  if (!named) return null;
  return ok({
    error: ownerOnlyText(agent.name, kind),
    reason: OWNER_ONLY_REASON,
  });
}

/** The field a result carries `ownerOnlyConversationsLeftOut` under. */
export const OWNER_ONLY_LEFT_OUT_FIELD = 'notIncluded';

/**
 * What a list of conversations says when it left the assistant's out
 * (CLEAN-267): a list over every agent the caller may read, asked by a
 * person who has the assistant and is not the Owner. Null for everybody
 * else, for whom nothing was left out that they could know of.
 *
 * A list that is silent about it reads as "there are none", and that is
 * what the model told an Admin. The sentence goes beside the rows, under
 * `OWNER_ONLY_LEFT_OUT_FIELD`.
 */
export function ownerOnlyConversationsLeftOut(
  httpRequest: Request,
): string | null {
  const agent = ownerOnlyAgent(httpRequest);
  if (!agent) return null;
  const name = agent.name.trim();
  const whose = name ? `${name}, the Ranch assistant,` : 'the Ranch assistant';
  return (
    `The conversations of ${whose} are not included: only the Owner can ` +
    'read them. That is an access limit, not an empty list.'
  );
}

/** A person, or an agent acting for itself, who lacks the role. */
export const OPERATOR_REFUSAL =
  'This tool requires the Ranch operator role. Ask the operator to do it ' +
  'in the console, or through the Ranch admin agent.';

/** Nobody is signed in behind this call. */
export const GUEST_REFUSAL = 'This needs a signed-in administrator.';

export const PERSON_REFUSAL = 'This needs a signed-in person.';

function refuseBelow(httpRequest: Request): never {
  const kind = callerParty(httpRequest).kind;
  throw new ForbiddenException(
    kind === 'guest' || kind === 'peer' ? GUEST_REFUSAL : OPERATOR_REFUSAL,
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
