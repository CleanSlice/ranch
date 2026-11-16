/**
 * The Overview page's unsaved edits, as pure functions (CLEAN-228,
 * specs/031-agent-overview-redesign/data-model.md "Draft").
 *
 * The draft is NOT a second copy of the agent (docs/state.md). It holds only
 * the fields the operator touched; everything else is read from what the
 * stores hold now, so an untouched field follows a refetch or a stream frame
 * and a touched one keeps what was typed. "Changed" is worked out against the
 * CURRENT saved value every time, so a field set back by hand stops counting.
 *
 * No Vue / Nuxt imports: this file runs under `bun test`. The binding to the
 * stores is `composables/useAgentDraft.ts`.
 */
import type { IAgentData, IUpdateAgentData } from '#agent/domain/agent.types';
import type { IAgentLimits } from '#agent/domain/agentLimit.types';

/** Everything Overview can edit, flat — one key per countable change. */
export interface IDraftFields {
  name: string;
  /** `agent.config.description`; absent there is empty here. */
  description: string;
  llmCredentialId: string | null;
  /** `[]` = the template's knowledge bases. */
  knowledgeIds: string[];
  cpu: string;
  memory: string;
  debugEnabled: boolean;
  isPublic: boolean;
  allowedOrigins: string[];
  /** `null` = that window is not limited. `NaN` = text that is not a number:
   *  it counts as a change and is refused before anything is sent. */
  perMinute: number | null;
  perHour: number | null;
  perDay: number | null;
}

export type DraftField = keyof IDraftFields;

/** Only what the operator edited. A key that is absent is untouched. */
export type DraftTouched = Partial<IDraftFields>;

/** In the order the page shows them — the order of `changedFields`. */
export const DRAFT_FIELDS: readonly DraftField[] = [
  'name',
  'description',
  'llmCredentialId',
  'knowledgeIds',
  'cpu',
  'memory',
  'debugEnabled',
  'isPublic',
  'allowedOrigins',
  'perMinute',
  'perHour',
  'perDay',
];

export const LIMIT_DRAFT_FIELDS = ['perMinute', 'perHour', 'perDay'] as const;

export type LimitDraftField = (typeof LIMIT_DRAFT_FIELDS)[number];

/** The part of the agent record the draft reads. */
export type DraftAgent = Pick<
  IAgentData,
  | 'name'
  | 'config'
  | 'llmCredentialId'
  | 'knowledgeIds'
  | 'resources'
  | 'debugEnabled'
  | 'isPublic'
  | 'allowedOrigins'
>;

export interface IAgentDraft {
  /** What the stores hold now, in the draft's flat shape. */
  saved: IDraftFields;
  value<K extends DraftField>(field: K): IDraftFields[K];
  changed(field: DraftField): boolean;
  changedFields: DraftField[];
  count: number;
  /** CPU or memory changed: the bar offers "Save and restart". */
  needsRestartOffer: boolean;
  /** Something other than a limit changed: the agent needs a restart to see it. */
  marksPendingRestart: boolean;
  /** The public switch or a limit changed: save through the limit store. */
  touchesLimitPath: boolean;
  /** What the three limit fields say, changed or not; `null` = limits off. */
  limits(): IAgentLimits | null;
  /** `PUT /agents/:id` body with the changed fields only. */
  payload(): IUpdateAgentData;
}

/** What is saved, in the draft's flat shape. `limits`: the limit record's
 *  (`null` = off, `undefined` = not read yet — both three empty fields). */
export function savedDraftFields(
  agent: DraftAgent,
  limits: IAgentLimits | null | undefined,
): IDraftFields {
  const description = agent.config?.description;
  return {
    name: agent.name,
    description: typeof description === 'string' ? description : '',
    llmCredentialId: agent.llmCredentialId,
    knowledgeIds: agent.knowledgeIds,
    cpu: agent.resources?.cpu ?? '',
    memory: agent.resources?.memory ?? '',
    debugEnabled: agent.debugEnabled,
    isPublic: agent.isPublic,
    allowedOrigins: agent.allowedOrigins,
    perMinute: limits?.perMinute ?? null,
    perHour: limits?.perHour ?? null,
    perDay: limits?.perDay ?? null,
  };
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (let i = 0; i < b.length; i += 1) {
    if (!left.has(b[i]!)) return false;
  }
  return true;
}

/** The equality of data-model.md, per field. */
export function draftFieldEqual<K extends DraftField>(
  field: K,
  a: IDraftFields[K],
  b: IDraftFields[K],
): boolean {
  switch (field) {
    case 'name':
    case 'description':
    case 'cpu':
    case 'memory':
      return String(a ?? '').trim() === String(b ?? '').trim();
    case 'knowledgeIds':
      return sameSet(a as string[], b as string[]);
    case 'allowedOrigins':
      return sameList(a as string[], b as string[]);
    default:
      // ids, booleans, limits. `NaN === NaN` is false on purpose: unreadable
      // text in a limit field is always a change.
      return a === b;
  }
}

/**
 * The edit recorded: a new `touched`, the old one left alone. A field set to
 * what is saved right now is dropped from it — it is untouched again, and
 * follows the saved value from then on.
 */
export function setDraftField<K extends DraftField>(
  agent: DraftAgent,
  limits: IAgentLimits | null | undefined,
  touched: DraftTouched,
  field: K,
  value: IDraftFields[K],
): DraftTouched {
  const next: DraftTouched = { ...touched };
  if (draftFieldEqual(field, value, savedDraftFields(agent, limits)[field])) {
    delete next[field];
  } else {
    next[field] = value;
  }
  return next;
}

export function agentDraft(
  agent: DraftAgent,
  limits: IAgentLimits | null | undefined,
  touched: DraftTouched,
): IAgentDraft {
  const saved = savedDraftFields(agent, limits);

  function value<K extends DraftField>(field: K): IDraftFields[K] {
    const edited = touched[field];
    return edited !== undefined ? (edited as IDraftFields[K]) : saved[field];
  }

  function changed(field: DraftField): boolean {
    const edited = touched[field];
    if (edited === undefined) return false;
    return !draftFieldEqual(field, edited as never, saved[field] as never);
  }

  const changedFields: DraftField[] = [];
  for (let i = 0; i < DRAFT_FIELDS.length; i += 1) {
    if (changed(DRAFT_FIELDS[i]!)) changedFields.push(DRAFT_FIELDS[i]!);
  }

  let limitChanged = false;
  let otherChanged = false;
  for (let i = 0; i < changedFields.length; i += 1) {
    if ((LIMIT_DRAFT_FIELDS as readonly string[]).includes(changedFields[i]!)) {
      limitChanged = true;
    } else {
      otherChanged = true;
    }
  }

  function limitsNow(): IAgentLimits | null {
    const next: IAgentLimits = {
      perMinute: value('perMinute'),
      perHour: value('perHour'),
      perDay: value('perDay'),
    };
    if (next.perMinute === null && next.perHour === null && next.perDay === null) {
      return null;
    }
    return next;
  }

  function payload(): IUpdateAgentData {
    const body: IUpdateAgentData = {};
    if (changed('name')) body.name = value('name').trim();
    if (changed('description')) {
      // The config saved NOW, never one remembered from when the page opened:
      // a key written elsewhere in the meantime is not undone by this save.
      const config: Record<string, unknown> = { ...agent.config };
      const description = value('description').trim();
      if (description) config.description = description;
      else delete config.description;
      body.config = config;
    }
    if (changed('llmCredentialId')) body.llmCredentialId = value('llmCredentialId');
    if (changed('knowledgeIds')) body.knowledgeIds = [...value('knowledgeIds')];
    if (changed('cpu') || changed('memory')) {
      // The API replaces `resources` whole, so the unchanged half goes too.
      body.resources = {
        cpu: value('cpu').trim(),
        memory: value('memory').trim(),
      };
    }
    if (changed('debugEnabled')) body.debugEnabled = value('debugEnabled');
    if (changed('isPublic')) body.isPublic = value('isPublic');
    if (changed('allowedOrigins')) body.allowedOrigins = [...value('allowedOrigins')];
    if (limitChanged) body.limits = limitsNow();
    return body;
  }

  return {
    saved,
    value,
    changed,
    changedFields,
    count: changedFields.length,
    needsRestartOffer: changed('cpu') || changed('memory'),
    marksPendingRestart: otherChanged,
    touchesLimitPath: limitChanged || changed('isPublic'),
    limits: limitsNow,
    payload,
  };
}
