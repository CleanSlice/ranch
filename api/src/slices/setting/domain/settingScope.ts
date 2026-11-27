import { AsyncLocalStorage } from 'node:async_hooks';
import type { ISettingData } from './setting.types';

/**
 * Settings as one agent is served them (CLEAN-271).
 *
 * The Ranch assistant is deployed from the values the Owner approved, not
 * from the live ones: an Admin runs the installation from the Settings
 * pages, and several of those settings decide what the assistant loads and
 * where its token goes (the bucket its workspace is pulled from, the address
 * it calls the API at, the address its manifest is submitted to). So a
 * setting an Admin changed keeps its approved value for the assistant until
 * the Owner applies the change.
 *
 * This file is the mechanism and knows nothing of the assistant. There is
 * ONE reader of settings, `ISettingGateway`, and every read it answers is
 * made in one of three states, carried by `AsyncLocalStorage` so that every
 * consumer below a call (the workflow gateway, the S3 clients, the infra
 * config, the knowledge config) reads in it without being told:
 *
 *   approved    `withApprovedSettings(fn)`: work done for the assistant.
 *               A key the Owner's approved values hold is answered with
 *               the approved value (`null`: there is no such row).
 *   live        `withLiveSettings(fn)`: work that SAID it is not for the
 *               assistant: another agent's deploy, a request that names
 *               another agent or none, the Settings pages themselves.
 *   undeclared  neither was said: a hub handler, a scheduled job, a path
 *               nobody thought about. Answered as APPROVED. That is the
 *               direction this fails in on purpose: code that forgot to say
 *               whom it works for cannot hand the assistant, or anybody, a
 *               value the Owner has not seen. The cost is that such work
 *               follows an Admin's change only once the Owner applied it.
 *
 * The scope is a MARKER, never a copy of the approved values. A piece of
 * work for the assistant is long (a deploy resyncs a template, syncs skills
 * and resolves a manifest, with an await between every two of them), and an
 * Admin may change a setting in the middle of it. A copy taken when the
 * work began would not hold that change, and the next read would fall
 * through to the Admin's live value. So each read asks again, and asks
 * consistently: the reader takes the setting rows and the approved values
 * in ONE snapshot of the database (`SettingGateway`), because a write moves
 * both in one transaction and two separate reads could see one of them
 * before it and the other after.
 *
 * While nothing differs from what the Owner approved the three states
 * answer the same.
 *
 * Who decides what the overrides hold is the assistantBuild slice, which
 * registers itself here at start (`registerAssistantSettings`), the way the
 * access lists are introduced to the assistant's switch.
 */

export type SettingOverrides = ReadonlyMap<string, ISettingData | null>;

export const settingKeyOf = (group: string, name: string): string =>
  `${group}.${name}`;

const LIVE = Symbol('live settings');
const APPROVED = Symbol('approved settings');
type Scope = typeof LIVE | typeof APPROVED;

const scope = new AsyncLocalStorage<Scope>();

/**
 * Run `fn` as work done for the assistant: every read in it is answered
 * with the values the Owner approved, as they stand at that read.
 */
export function withApprovedSettings<T>(fn: () => T): T {
  return scope.run(APPROVED, fn);
}

/** Run `fn` as work that is not for the assistant: every read is live. */
export function withLiveSettings<T>(fn: () => T): T {
  return scope.run(LIVE, fn);
}

/** How the current work reads settings. */
export function settingScopeState(): 'approved' | 'live' | 'undeclared' {
  const current = scope.getStore();
  if (current === undefined) return 'undeclared';
  return current === LIVE ? 'live' : 'approved';
}

let undeclaredListener: ((key: string) => void) | null = null;

/**
 * Told of every read made with nothing declared. For the spec that holds
 * the deploy path, and whatever else it walks, to declaring whom it works
 * for; nothing in production listens.
 */
export function onUndeclaredSettingRead(
  listener: ((key: string) => void) | null,
): void {
  undeclaredListener = listener;
}

/**
 * Where the current work's read of `key` takes the approved values from;
 * null when it reads live (it said so, or the installation has no
 * assistant settings at all). Nothing is read here and nothing remembered:
 * the reader asks the source inside the snapshot it reads the rows in.
 */
export function approvedSettingsFor(
  key: string,
): IAssistantSettingSource | null {
  const current = scope.getStore();
  if (current === LIVE) return null;
  if (current === undefined) undeclaredListener?.(key);
  return source;
}

/** `rows` of a group, or of every group, read through `overrides`. */
export function applySettingOverrides(
  rows: readonly ISettingData[],
  overrides: SettingOverrides | null,
  group?: string,
): ISettingData[] {
  if (!overrides) return [...rows];
  const byKey = new Map(
    rows.map((row) => [settingKeyOf(row.group, row.name), row]),
  );
  for (const [key, row] of overrides) {
    if (group !== undefined && !key.startsWith(`${group}.`)) continue;
    if (row === null) byKey.delete(key);
    else byKey.set(key, row);
  }
  return [...byKey.values()].sort(
    (a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name),
  );
}

// ── The assistant's approved settings, introduced at start ───

/** One setting whose live value is not the one the Owner approved. */
export interface ISettingDrift {
  group: string;
  name: string;
  /** What happened to the live row since: never the values themselves. */
  change: 'changed' | 'added' | 'removed';
  changedById: string | null;
  changedAt: Date;
  /**
   * Names this exact state of the setting: who changed it last and when,
   * and when the live row was last written. Opaque, and holds no value. The
   * Owner applies what they were SHOWN: an apply that carries another
   * version is refused.
   */
  version: string;
}

/** Who writes a setting: the Owner moves the approved value, nobody else. */
export interface ISettingWriter {
  userId: string | null;
  owner: boolean;
}

export interface IAssistantSettingSource {
  /**
   * The approved values that differ from the live ones; empty when none.
   * `db` is the client of the snapshot the caller reads the setting rows
   * in (typed loosely: this file does not know the database), so that both
   * are of one moment.
   */
  overrides(db?: unknown): Promise<SettingOverrides>;
  /** The id of the Ranch assistant, when there is one. */
  assistantId(): Promise<string | null>;
  drift(): Promise<ISettingDrift[]>;
}

let source: IAssistantSettingSource | null = null;

export function registerAssistantSettings(
  next: IAssistantSettingSource | null,
): void {
  source = next;
}

/**
 * Run `fn` as work done for an agent, having said which kind: the Ranch
 * assistant reads the approved settings, any other agent the live ones.
 * The caller knows the agent it acts for; this is where it says so.
 */
export function servingAssistant<T>(
  isAssistant: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  return isAssistant ? withApprovedSettings(fn) : withLiveSettings(fn);
}

/** `servingAssistant`, for a caller that holds an agent id and not the row. */
export async function servingAgentId<T>(
  agentId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!source || !agentId) return servingAssistant(false, fn);
  return servingAssistant((await source.assistantId()) === agentId, fn);
}

/** What the Owner is told differs; empty for an installation with no source. */
export function assistantSettingDrift(): Promise<ISettingDrift[]> {
  return source ? source.drift() : Promise.resolve([]);
}

/** The source itself, for the interceptor that scopes a request. */
export function assistantSettingSource(): IAssistantSettingSource | null {
  return source;
}
