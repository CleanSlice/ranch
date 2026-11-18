import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IAgentReach } from '#/agent/agent/domain/agentPermission.service';
import { IUserGateway } from '#/user/user/domain/user.gateway';
import { UserRoleTypes } from '#/user/user/domain/user.types';
import { IAgentAccessGateway, IAgentAccessTx } from './agentAccess.gateway';
import {
  AGENT_ACCESS_REFUSALS,
  AgentAccessError,
  AgentAccessErrorCodes,
  AgentReach,
  accessSubject,
  type AgentAccessOutcomeKinds,
  type IAccessCaller,
  type IAccessEditor,
  type IAgentAccessChangeOptions,
  type IAgentAccessChangeResult,
  type IAgentAccessDelta,
  type IAgentAccessDesired,
  type IAgentAccessEntry,
  type IAgentAccessState,
  type IAgentAccessSummary,
  type IAgentAccessView,
} from './agentAccess.types';

/** What every agent route answers for an agent that does not exist. */
export const AGENT_NOT_FOUND_MESSAGE = 'Agent not found';

type ChangedListener = (userId: string) => void;

const allowedOf = (state: Pick<IAgentAccessState, 'entries'>): string[] =>
  state.entries.filter((e) => e.list === 'allowed').map((e) => e.agentId);

const deniedOf = (state: Pick<IAgentAccessState, 'entries'>): string[] =>
  state.entries.filter((e) => e.list === 'denied').map((e) => e.agentId);

/** `restricted`, `needsReview` and the outcome kind, from the stored state. */
export function summarize(
  state: Pick<IAgentAccessState, 'limited' | 'entries'> | null | undefined,
): IAgentAccessSummary {
  if (!state) return { kind: 'all', needsReview: false };
  const allowed = allowedOf(state).length;
  const denied = deniedOf(state).length;
  const kind: AgentAccessOutcomeKinds = state.limited
    ? allowed > 0
      ? 'only'
      : 'none'
    : denied > 0
      ? 'all_except'
      : 'all';
  return { kind, needsReview: state.limited && allowed === 0 };
}

/**
 * Who may change whose agent access. Returns the sentence to refuse with,
 * or null. It agrees with the account rule of CLEAN-232 (`refuseUserEdit`):
 * the Owner changes Admins and Users, an Admin changes Users, nobody changes
 * the Owner's or their own. A trusted party acts as the Owner.
 */
export function refuseAccessEdit(
  editor: IAccessEditor,
  target: { id: string; role: UserRoleTypes },
): string | null {
  if (target.role === UserRoleTypes.Owner) return AGENT_ACCESS_REFUSALS.owner;
  if (editor.kind === 'trusted') return null;
  if (target.id === editor.userId) return AGENT_ACCESS_REFUSALS.self;
  if (editor.role === UserRoleTypes.Owner) return null;
  if (editor.role !== UserRoleTypes.Admin) {
    return AGENT_ACCESS_REFUSALS.notAllowed;
  }
  if (target.role === UserRoleTypes.Admin) {
    return AGENT_ACCESS_REFUSALS.otherAdmin;
  }
  return target.role === UserRoleTypes.User
    ? null
    : AGENT_ACCESS_REFUSALS.notAllowed;
}

const isOwnerEditor = (editor: IAccessEditor): boolean =>
  editor.kind === 'trusted' || editor.role === UserRoleTypes.Owner;

const uniq = (ids: readonly string[] | undefined): string[] => [
  ...new Set((ids ?? []).filter((id) => typeof id === 'string' && id !== '')),
];

/**
 * Which agents an account reaches (CLEAN-231), and the one write path of the
 * lists behind it.
 *
 *   reaches(caller, agent) =
 *       true    if the caller is not a person with role Admin or User
 *       false   if the agent is on the caller's denied list
 *       false   if the account is limited and the agent is not allowed
 *       true    otherwise
 *
 * The caller is the effective caller: the person on a console token, or the
 * person an agent proved it acts for. The Owner, a trusted agent, an agent
 * runtime and every caller that is not a person are never restricted. The
 * lists are read from the database on every call, one indexed query, no
 * cache: a change applies to the person's very next action (FR-010).
 *
 * It is the real `IAgentReach` behind `AgentPermissionService.canManage`,
 * so every management route and `manage-agent` tool already honours it.
 */
@Injectable()
export class AgentAccessService implements IAgentReach {
  private readonly logger = new Logger(AgentAccessService.name);
  private readonly listeners = new Set<ChangedListener>();
  private readonly removedListeners = new Set<ChangedListener>();

  constructor(
    private readonly gateway: IAgentAccessGateway,
    private readonly users: IUserGateway,
  ) {}

  // ── The rule ────────────────────────────────────────────────

  /** The agents this caller reaches, as a set to ask and filter with. */
  async reachableIds(caller: IAccessCaller): Promise<AgentReach> {
    const subject = accessSubject(caller);
    if (!subject) return AgentReach.ALL;
    return new AgentReach(await this.gateway.load(subject.userId));
  }

  async reaches(caller: IAccessCaller, agentId: string): Promise<boolean> {
    return (await this.reachableIds(caller)).has(agentId);
  }

  /**
   * Whether the caller reaches an agent that exists. For a person the
   * lists apply to, an id that names no agent is not reached either, so a
   * route that asks here answers a hidden agent and a missing one alike,
   * whatever the route itself does with an unknown id. Nobody else is
   * looked up for: what the Owner gets for an unknown id is the route's own
   * business, as before.
   */
  async reachesExisting(
    caller: IAccessCaller,
    agentId: string,
  ): Promise<boolean> {
    const subject = accessSubject(caller);
    if (!subject) return true;
    if (!agentId) return false;
    const reach = new AgentReach(await this.gateway.load(subject.userId));
    return reach.has(agentId) && (await this.gateway.agentExists(agentId));
  }

  /**
   * Refuse, as an agent that does not exist, an agent the caller does not
   * reach. `notFound` is the route's own "not found", so the two answers
   * are the same answer (FR-008).
   */
  async assertReaches(
    caller: IAccessCaller,
    agentId: string | null | undefined,
    notFound: string = AGENT_NOT_FOUND_MESSAGE,
  ): Promise<void> {
    if (typeof agentId !== 'string' || !agentId) return;
    if (!(await this.reaches(caller, agentId))) {
      throw new NotFoundException(notFound);
    }
  }

  // ── What the lists come to ──────────────────────────────────

  /** The outcome of one account, whole (not limited to a viewer's view). */
  async outcome(userId: string): Promise<IAgentAccessSummary> {
    return summarize(await this.gateway.load(userId));
  }

  /** The mark of each account on the user list. The Owner's is always `all`. */
  async summaries(
    users: readonly { id: string; role: UserRoleTypes }[],
  ): Promise<Map<string, IAgentAccessSummary>> {
    const subjects = users.filter((u) => u.role !== UserRoleTypes.Owner);
    const states = await this.gateway.loadMany(subjects.map((u) => u.id));
    return new Map(
      users.map((u) => [
        u.id,
        u.role === UserRoleTypes.Owner
          ? summarize(null)
          : summarize(states.get(u.id)),
      ]),
    );
  }

  /** One account's access as this viewer may see it (`GET`). */
  async view(
    viewer: IAccessEditor,
    targetId: string,
  ): Promise<IAgentAccessView> {
    const target = await this.requireTarget(targetId);
    if (!isOwnerEditor(viewer)) {
      const refusal = refuseAccessEdit(viewer, target);
      if (refusal) {
        throw new AgentAccessError(AgentAccessErrorCodes.NotEditable, refusal);
      }
    }
    const [viewerReach, state, agentIds] = await Promise.all([
      this.reachOfEditor(viewer),
      // While an account is the Owner its lists are ignored, not erased.
      target.role === UserRoleTypes.Owner
        ? Promise.resolve<IAgentAccessState>({
            userId: target.id,
            limited: false,
            entries: [],
            updatedAt: null,
          })
        : this.gateway.load(target.id),
      this.gateway.agentIds(),
    ]);
    return toView(state, viewerReach, agentIds);
  }

  // ── The one write path ──────────────────────────────────────

  /**
   * Replace the part of an account's access that lies inside the editor's
   * view (research R8). `desired` is the whole desired state there; an agent
   * absent from both arrays ends with no entry.
   */
  replace(
    editor: IAccessEditor,
    targetId: string,
    desired: IAgentAccessDesired,
    opts: IAgentAccessChangeOptions = {},
  ): Promise<IAgentAccessChangeResult> {
    return this.change(editor, targetId, () => desired, opts);
  }

  /**
   * The same change stated as moves onto the current view: `allow` and
   * `deny` put agents on a list (and take them off the other), `clear`
   * leaves them with no entry. Computed inside the transaction, so it needs
   * no `version`.
   */
  adjust(
    editor: IAccessEditor,
    targetId: string,
    delta: IAgentAccessDelta,
    opts: IAgentAccessChangeOptions = {},
  ): Promise<IAgentAccessChangeResult> {
    const allow = uniq(delta.allow);
    const deny = uniq(delta.deny);
    const clear = uniq(delta.clear);
    const named = [...allow, ...deny, ...clear];
    if (new Set(named).size !== named.length) {
      return Promise.reject(
        new AgentAccessError(
          AgentAccessErrorCodes.ListsOverlap,
          AGENT_ACCESS_REFUSALS.overlap,
        ),
      );
    }
    return this.change(
      editor,
      targetId,
      (current, known) => {
        // An id the editor cannot see must be refused whichever move names
        // it, so `clear` is checked here: it leaves no trace in the result.
        if (clear.some((id) => !known(id))) throw agentNotFound();
        const moved = new Set(named);
        return {
          allowed: [
            ...current.allowed.filter((id) => !moved.has(id)),
            ...allow,
          ],
          denied: [...current.denied.filter((id) => !moved.has(id)), ...deny],
        };
      },
      opts,
    );
  }

  private async change(
    editor: IAccessEditor,
    targetId: string,
    compute: (
      current: IAgentAccessDesired,
      inView: (agentId: string) => boolean,
    ) => IAgentAccessDesired,
    opts: IAgentAccessChangeOptions,
  ): Promise<IAgentAccessChangeResult> {
    // 1. Who may edit whom.
    const target = await this.requireTarget(targetId);
    const refusal = refuseAccessEdit(editor, target);
    if (refusal) {
      throw new AgentAccessError(AgentAccessErrorCodes.NotEditable, refusal);
    }
    const viewerReach = await this.reachOfEditor(editor);
    const updatedById = editor.kind === 'person' ? editor.userId : null;
    const checksCeiling =
      editor.kind === 'person' && editor.role !== UserRoleTypes.Owner;

    const result = await this.gateway.transaction(
      target.id,
      async (tx: IAgentAccessTx): Promise<IAgentAccessChangeResult> => {
        const [state, agentIds] = [await tx.load(), await tx.agentIds()];

        // 6. Somebody else got there first.
        if (
          opts.version !== undefined &&
          opts.version !== (state.updatedAt?.toISOString() ?? null)
        ) {
          throw new AgentAccessError(
            AgentAccessErrorCodes.Changed,
            AGENT_ACCESS_REFUSALS.changed,
          );
        }

        // 2. The editor's view: the agents the editor reaches.
        const existing = new Set(agentIds);
        const inView = (id: string): boolean =>
          existing.has(id) && viewerReach.has(id);
        const wanted = compute(
          {
            allowed: allowedOf(state).filter(inView),
            denied: deniedOf(state).filter(inView),
          },
          inView,
        );
        const allowed = uniq(wanted.allowed);
        const denied = uniq(wanted.denied);
        if (allowed.some((id) => denied.includes(id))) {
          throw new AgentAccessError(
            AgentAccessErrorCodes.ListsOverlap,
            AGENT_ACCESS_REFUSALS.overlap,
          );
        }
        // An id that does not exist and one outside the view are the same
        // unknown agent, and one of either refuses the whole request.
        if ([...allowed, ...denied].some((id) => !inView(id))) {
          throw agentNotFound();
        }

        // 3. Entries about agents outside the view are carried over as is.
        const entries: IAgentAccessEntry[] = [
          ...state.entries.filter((e) => !inView(e.agentId)),
          ...allowed.map((agentId) => ({ agentId, list: 'allowed' as const })),
          ...denied.map((agentId) => ({ agentId, list: 'denied' as const })),
        ];
        const limited = entries.some((e) => e.list === 'allowed');
        const next: IAgentAccessState = { ...state, limited, entries };

        // 4. The ceiling, over outcomes: nothing the account newly reaches
        //    may be an agent the editor does not reach.
        if (checksCeiling) {
          const before = new AgentReach(state);
          const after = new AgentReach(next);
          const exceeds = agentIds.some(
            (id) => after.has(id) && !before.has(id) && !viewerReach.has(id),
          );
          if (exceeds) {
            throw new AgentAccessError(
              AgentAccessErrorCodes.ExceedsCeiling,
              AGENT_ACCESS_REFUSALS.ceiling,
            );
          }
        }

        // 5. A limited account becomes an open one only on a confirmed change.
        const opens = state.limited && !limited;
        if (opens && opts.confirmOpen !== true) {
          throw new AgentAccessError(
            AgentAccessErrorCodes.OpenNeedsConfirm,
            AGENT_ACCESS_REFUSALS.confirm,
            toView(next, viewerReach, agentIds).outcome,
          );
        }

        const unchanged =
          state.limited === limited && sameEntries(state.entries, entries);
        if (opts.dryRun === true || unchanged) {
          return {
            view: toView(next, viewerReach, agentIds),
            saved: false,
            opens,
          };
        }
        const saved = await tx.save({ limited, entries, updatedById });
        return {
          view: toView(saved, viewerReach, agentIds),
          saved: true,
          opens,
        };
      },
    );
    if (result.saved) this.notifyChanged(target.id);
    return result;
  }

  // ── Around the lists ────────────────────────────────────────

  /**
   * Called when access changed for an account, after the change is saved.
   * The chat hub uses it to close that person's sockets on agents they no
   * longer reach. Returns the function that stops listening.
   */
  onChanged(listener: ChangedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Called when an account is deleted. Unlike `onChanged` there is nothing
   * to ask again: everything that account holds open is to be closed.
   */
  onRemoved(listener: ChangedListener): () => void {
    this.removedListeners.add(listener);
    return () => this.removedListeners.delete(listener);
  }

  /**
   * The account is being deleted: its row and entries go with it, and its
   * open sockets are closed whatever the lists said. The listeners are told
   * even when the cleanup fails: a row left behind is debris, a socket left
   * open is a deleted person still reading.
   */
  async removeUser(userId: string): Promise<void> {
    try {
      await this.gateway.removeUser(userId);
    } finally {
      this.notify(this.removedListeners, userId);
    }
  }

  /**
   * `reachesExisting` for an account named by id alone, with the role read
   * from the database now. For a credential that outlives a session (the
   * browser extension's token): an account that is gone or disabled
   * reaches nothing, an Admin or User what their lists reach today.
   */
  async accountReachesExisting(
    userId: string,
    agentId: string,
  ): Promise<boolean> {
    const user = userId ? await this.users.findById(userId) : null;
    if (!user || user.status === 'disabled') return false;
    if (!agentId || !(await this.gateway.agentExists(agentId))) return false;
    return this.reaches({ userId: user.id, role: user.role }, agentId);
  }

  /**
   * A new agent joins its creator's allowed list when that account is
   * limited (FR-023). `tx` is the transaction creating the agent, so the
   * agent never exists without the entry.
   */
  allowCreated(tx: unknown, userId: string, agentId: string): Promise<boolean> {
    return this.gateway.allowCreated(tx, userId, agentId);
  }

  private notifyChanged(userId: string): void {
    this.notify(this.listeners, userId);
  }

  private notify(listeners: Set<ChangedListener>, userId: string): void {
    for (const listener of listeners) {
      try {
        listener(userId);
      } catch (err) {
        this.logger.warn(
          `An access-change listener failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async requireTarget(
    targetId: string,
  ): Promise<{ id: string; role: UserRoleTypes }> {
    const user = targetId ? await this.users.findById(targetId) : null;
    if (!user) {
      throw new AgentAccessError(
        AgentAccessErrorCodes.UserNotFound,
        AGENT_ACCESS_REFUSALS.userNotFound,
      );
    }
    return { id: user.id, role: user.role };
  }

  private reachOfEditor(editor: IAccessEditor): Promise<AgentReach> {
    return this.reachableIds(editor.kind === 'person' ? editor : null);
  }
}

function agentNotFound(): AgentAccessError {
  return new AgentAccessError(
    AgentAccessErrorCodes.AgentNotFound,
    AGENT_ACCESS_REFUSALS.agentNotFound,
  );
}

function sameEntries(
  a: readonly IAgentAccessEntry[],
  b: readonly IAgentAccessEntry[],
): boolean {
  if (a.length !== b.length) return false;
  const key = (e: IAgentAccessEntry) => `${e.list}:${e.agentId}`;
  const left = new Set(a.map(key));
  return b.every((e) => left.has(key(e)));
}

/**
 * A state as one viewer may see it: the entries inside the viewer's view,
 * the outcome with its count taken from those, and whether there is more
 * the viewer cannot see. No id of anything outside the view leaves here.
 */
export function toView(
  state: IAgentAccessState,
  viewerReach: AgentReach,
  agentIds: readonly string[],
): IAgentAccessView {
  const inView = (id: string) => viewerReach.has(id);
  const allowed = allowedOf(state).filter(inView);
  const denied = deniedOf(state).filter(inView);
  const { kind, needsReview } = summarize(state);
  const targetReach = new AgentReach(state);
  const hasEntriesOutsideView =
    state.entries.some((e) => !inView(e.agentId)) ||
    agentIds.some((id) => targetReach.has(id) && !inView(id));
  return {
    userId: state.userId,
    allowed,
    denied,
    outcome: {
      kind,
      count:
        kind === 'only'
          ? allowed.length
          : kind === 'all_except'
            ? denied.length
            : 0,
    },
    needsReview,
    hasEntriesOutsideView,
    version: state.updatedAt ? state.updatedAt.toISOString() : null,
  };
}
