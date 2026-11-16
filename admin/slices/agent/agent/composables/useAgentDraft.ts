import type { ComputedRef, InjectionKey, MaybeRefOrGetter, Ref } from 'vue';
import {
  agentDraft,
  setDraftField,
  type DraftAgent,
  type DraftField,
  type DraftTouched,
  type IAgentDraft,
  type IDraftFields,
} from '#agent/utils/agentDraft';
import {
  findLimitProblem,
  limitNumbersToForm,
  placeRefusalByField,
  type IPlacedRefusal,
  type RefusalPlace,
} from '#agent/utils/agentLimitForm';

/**
 * The Overview page's one draft (CLEAN-228, research R3–R4): every block reads
 * and writes its fields here, and one bar saves or discards them together.
 *
 * Nothing in here is a copy of the agent (docs/state.md). `touched` holds only
 * what the operator edited; everything else is read from the agent store and
 * the limit store at the moment it is asked for. The rules — what counts as a
 * change, what the request carries, when a restart is owed — are the pure
 * `utils/agentDraft.ts`; this file only binds them to the two stores and
 * sends the save.
 *
 * The draft lives as long as the component that created it: `provideAgentDraft`
 * in the page, `useInjectedAgentDraft` in its blocks.
 */

/** Where a refusal is shown: by a field, or under the three limits. */
export type DraftErrorPlace = DraftField | 'limits';

export interface IDraftError {
  /** The server's refusal code (`PUBLIC_AGENT_NEEDS_LIMITS`, …) or `null`
   *  for a check made here. */
  code: string | null;
  text: string;
}

export type DraftErrors = Partial<Record<DraftErrorPlace, IDraftError>>;

export interface IAgentDraftApi {
  agentId: ComputedRef<string>;
  /** The field as the page shows it: the edit if there is one, else what is saved. */
  value<K extends DraftField>(field: K): IDraftFields[K];
  /** The field differs from what is saved right now. */
  changed(field: DraftField): boolean;
  set<K extends DraftField>(field: K, value: IDraftFields[K]): void;
  /** Every field back to what is saved; errors cleared. */
  discard(): void;
  /** Number of changed fields. */
  count: ComputedRef<number>;
  isDirty: ComputedRef<boolean>;
  changedFields: ComputedRef<DraftField[]>;
  /** CPU or memory is among the changes: offer "Save and restart". */
  needsRestartOffer: ComputedRef<boolean>;
  /** `false` until the limit record has been read: limits cannot be edited
   *  or saved before that. */
  limitsKnown: ComputedRef<boolean>;
  /** A refused save, by the field it concerns. Cleared as the field is edited. */
  errors: Ref<DraftErrors>;
  /** A failed save that belongs to no field (network, an unknown refusal). */
  generalError: Ref<string | null>;
  /** The save went through but the restart asked for with it did not. */
  restartError: Ref<string | null>;
  saving: Ref<boolean>;
  /**
   * Saves every change in one request. `true` when it was saved; `false` when
   * it was refused or failed — the draft is then exactly as it was, with the
   * reason in `errors` or `generalError`.
   */
  save(options?: { restart?: boolean }): Promise<boolean>;
}

const EMPTY_AGENT: DraftAgent = {
  name: '',
  config: {},
  llmCredentialId: null,
  knowledgeIds: [],
  resources: { cpu: '', memory: '' },
  debugEnabled: false,
  isPublic: false,
  allowedOrigins: [],
};

const LIMIT_PATH_PLACES: readonly DraftErrorPlace[] = [
  'perMinute',
  'perHour',
  'perDay',
  'limits',
  'isPublic',
];

const PLACE_TO_FIELD: Record<RefusalPlace, DraftErrorPlace> = {
  minute: 'perMinute',
  hour: 'perHour',
  day: 'perDay',
  limits: 'limits',
  public: 'isPublic',
};

function messageOf(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return e?.response?.data?.message ?? e?.message ?? fallback;
}

export function useAgentDraft(id: MaybeRefOrGetter<string>): IAgentDraftApi {
  const agentStore = useAgentStore();
  const limitStore = useAgentLimitStore();

  const agentId = computed(() => toValue(id));
  const agent = computed<DraftAgent>(
    () => agentStore.byId(agentId.value) ?? EMPTY_AGENT,
  );
  // `undefined`: not read yet. `null`: read, and limits are off.
  const savedLimits = computed(() => limitStore.byAgent[agentId.value]?.limits);
  const limitsKnown = computed(() => savedLimits.value !== undefined);

  // Shallow on purpose: every edit replaces the object (`setDraftField`), and
  // "is this still what was sent" below compares by identity.
  const touched = shallowRef<DraftTouched>({});
  const view = computed<IAgentDraft>(() =>
    agentDraft(agent.value, savedLimits.value, touched.value),
  );

  const errors = ref<DraftErrors>({});
  const generalError = ref<string | null>(null);
  const restartError = ref<string | null>(null);
  const saving = ref(false);

  // Another agent under the same component: its edits are not this one's.
  watch(agentId, () => {
    touched.value = {};
    errors.value = {};
    generalError.value = null;
    restartError.value = null;
  });

  function value<K extends DraftField>(field: K): IDraftFields[K] {
    return view.value.value(field);
  }

  function changed(field: DraftField): boolean {
    return view.value.changed(field);
  }

  function dropErrors(places: readonly DraftErrorPlace[]): void {
    let next: DraftErrors | null = null;
    for (let i = 0; i < places.length; i += 1) {
      if (!(places[i]! in errors.value)) continue;
      next = next ?? { ...errors.value };
      delete next[places[i]!];
    }
    if (next) errors.value = next;
  }

  function set<K extends DraftField>(field: K, next: IDraftFields[K]): void {
    touched.value = setDraftField(
      agent.value,
      savedLimits.value,
      touched.value,
      field,
      next,
    );
    // A sentence belongs to what was sent; once that changes it is stale. The
    // public switch and the limits answer for each other's refusals.
    dropErrors(LIMIT_PATH_PLACES.includes(field) ? LIMIT_PATH_PLACES : [field]);
    generalError.value = null;
  }

  function discard(): void {
    touched.value = {};
    errors.value = {};
    generalError.value = null;
  }

  function place(refusals: IPlacedRefusal[]): void {
    const next: DraftErrors = { ...errors.value };
    for (let i = 0; i < refusals.length; i += 1) {
      const refusal = refusals[i]!;
      next[PLACE_TO_FIELD[refusal.place]] = {
        code: refusal.code,
        text: refusal.text,
      };
    }
    errors.value = next;
  }

  // What cannot be sent at all, said at once and by its field. Whether a
  // PUBLIC agent may be saved without limits is the server's rule and the
  // server's answer (`isPublic: false` below skips that check).
  function findUnsendable(draft: IAgentDraft): boolean {
    let found = false;
    if (draft.changed('name') && !draft.value('name').trim()) {
      errors.value = {
        ...errors.value,
        name: { code: null, text: 'An agent needs a name.' },
      };
      found = true;
    }
    if (draft.touchesLimitPath) {
      const typed = limitNumbersToForm({
        perMinute: draft.value('perMinute'),
        perHour: draft.value('perHour'),
        perDay: draft.value('perDay'),
      });
      const problem = findLimitProblem(typed, false);
      if (problem) {
        place([problem]);
        found = true;
      }
    }
    return found;
  }

  async function restartNow(agentIdNow: string): Promise<void> {
    // As the restart banner does it: the in-flight mark goes first so a reload
    // in the next seconds still shows the agent as restarting.
    agentStore.markRestartInFlight(agentIdNow);
    try {
      await agentStore.restart(agentIdNow);
      agentStore.clearPendingRestart(agentIdNow);
    } catch (err) {
      agentStore.clearRestartInFlight(agentIdNow);
      // Saved, not restarted: leave it pending so the banner offers it again.
      agentStore.markPendingRestart(agentIdNow);
      restartError.value = messageOf(err, 'Restart failed');
    }
  }

  async function save(options: { restart?: boolean } = {}): Promise<boolean> {
    const draft = view.value;
    if (saving.value || draft.count === 0) return false;
    const agentIdNow = agentId.value;
    errors.value = {};
    generalError.value = null;
    restartError.value = null;

    if (findUnsendable(draft)) return false;
    if (draft.touchesLimitPath && !limitsKnown.value) {
      generalError.value =
        'The request limits have not loaded yet. Try again in a moment.';
      return false;
    }

    // Everything the request needs is read before it leaves: the stores move
    // while it is in flight.
    const sent: DraftTouched = { ...touched.value };
    const payload = draft.payload();
    const limits = draft.limits();
    const isPublic = draft.value('isPublic');
    const marksPendingRestart = draft.marksPendingRestart;
    const touchesLimitPath = draft.touchesLimitPath;
    const typed = limitNumbersToForm({
      perMinute: draft.value('perMinute'),
      perHour: draft.value('perHour'),
      perDay: draft.value('perDay'),
    });

    saving.value = true;
    try {
      if (touchesLimitPath) {
        // One `PUT /agents/:id` carries everything. It goes through the limit
        // store's `save`, so the limit record moves optimistically with it and
        // moves back if the server refuses; the agent record is only ever
        // written from the server's answer (`agentStore.update` upserts it).
        const result = await limitStore.save(agentIdNow, limits, async () => {
          await agentStore.update(agentIdNow, payload);
        });
        if (!result.ok) {
          const placed = placeRefusalByField(
            result.code,
            result.message,
            typed,
            isPublic,
          );
          if (placed.length) place(placed);
          else generalError.value = result.message;
          return false;
        }
      } else {
        try {
          await agentStore.update(agentIdNow, payload);
        } catch (err) {
          generalError.value = messageOf(err, 'Save failed');
          return false;
        }
      }

      // Saved. Drop what was sent — and only that: an edit made while the
      // request was in flight is still an edit.
      const rest: DraftTouched = { ...touched.value };
      const keys = Object.keys(sent) as DraftField[];
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]!;
        if (rest[key] === sent[key]) delete rest[key];
      }
      touched.value = rest;

      if (touchesLimitPath) {
        // The load snapshot carries `needsLimits` and the windows' ceilings;
        // bring it in line now rather than on the next poll.
        void limitStore.fetchLoad(agentIdNow).catch(() => undefined);
      }

      // Limits take effect on the next request and need no restart; every
      // other field reaches the pod on its next start (research R4).
      if (options.restart) await restartNow(agentIdNow);
      else if (marksPendingRestart) agentStore.markPendingRestart(agentIdNow);
      return true;
    } finally {
      saving.value = false;
    }
  }

  return {
    agentId,
    value,
    changed,
    set,
    discard,
    count: computed(() => view.value.count),
    isDirty: computed(() => view.value.count > 0),
    changedFields: computed(() => view.value.changedFields),
    needsRestartOffer: computed(() => view.value.needsRestartOffer),
    limitsKnown,
    errors,
    generalError,
    restartError,
    saving,
    save,
  };
}

export const AGENT_DRAFT_KEY: InjectionKey<IAgentDraftApi> = Symbol('agentDraft');

/** Creates the draft for this agent and hands it to every block below. */
export function provideAgentDraft(id: MaybeRefOrGetter<string>): IAgentDraftApi {
  const draft = useAgentDraft(id);
  provide(AGENT_DRAFT_KEY, draft);
  return draft;
}

/** The page's draft, or `null` outside a page that provides one. */
export function useOptionalAgentDraft(): IAgentDraftApi | null {
  return inject(AGENT_DRAFT_KEY, null);
}

/** The page's draft. Throws outside a page that provides one. */
export function useInjectedAgentDraft(): IAgentDraftApi {
  const draft = inject(AGENT_DRAFT_KEY, null);
  if (!draft) {
    throw new Error(
      'useInjectedAgentDraft: no draft provided — call provideAgentDraft() in the page',
    );
  }
  return draft;
}
