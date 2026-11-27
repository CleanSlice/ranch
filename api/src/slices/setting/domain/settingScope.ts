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
 * This file is the mechanism and knows nothing of the assistant. Work done
 * on an agent's behalf runs inside `withSettingOverrides(map, fn)`; inside
 * it `ISettingGateway` answers a key the map holds with the map's value
 * (`null` for "there is no such row") and every other key live. It is
 * carried by `AsyncLocalStorage`, so every reader below the call (the
 * workflow gateway, the S3 clients, the infra config, the knowledge config)
 * reads through it without being told: there is ONE reader of settings, the
 * gateway, and it cannot be bypassed by a consumer that forgot.
 *
 * Who decides what the map holds is the assistantBuild slice, which
 * registers itself here at start (`registerAssistantSettings`), the way the
 * access lists are introduced to the assistant's switch.
 */

export type SettingOverrides = ReadonlyMap<string, ISettingData | null>;

export const settingKeyOf = (group: string, name: string): string =>
  `${group}.${name}`;

const scope = new AsyncLocalStorage<SettingOverrides>();

/** Run `fn` with `overrides` answering for the keys they hold. */
export function withSettingOverrides<T>(
  overrides: SettingOverrides,
  fn: () => T,
): T {
  return scope.run(overrides, fn);
}

/** The overrides of the work this call belongs to; null outside any. */
export function currentSettingOverrides(): SettingOverrides | null {
  const overrides = scope.getStore();
  return overrides && overrides.size > 0 ? overrides : null;
}

/**
 * `undefined`: not overridden, read it live. `null`: overridden as absent.
 * A row: the value to answer with.
 */
export function overriddenSetting(
  group: string,
  name: string,
): ISettingData | null | undefined {
  const overrides = currentSettingOverrides();
  if (!overrides) return undefined;
  const key = settingKeyOf(group, name);
  return overrides.has(key) ? (overrides.get(key) ?? null) : undefined;
}

/** `rows` of a group, or of every group, as the current scope reads them. */
export function applySettingOverrides(
  rows: readonly ISettingData[],
  group?: string,
): ISettingData[] {
  const overrides = currentSettingOverrides();
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
}

/** Who writes a setting: the Owner moves the approved value, nobody else. */
export interface ISettingWriter {
  userId: string | null;
  owner: boolean;
}

export interface IAssistantSettingSource {
  /** The approved values that differ from the live ones; empty when none. */
  overrides(): Promise<SettingOverrides>;
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
 * Run `fn` as work done for the Ranch assistant when `isAssistant` is true:
 * its settings are the approved ones. For any other agent, and when nothing
 * differs from the live values, `fn` runs as it is.
 */
export async function servingAssistant<T>(
  isAssistant: boolean,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isAssistant || !source) return fn();
  const overrides = await source.overrides();
  if (overrides.size === 0) return fn();
  return withSettingOverrides(overrides, fn);
}

/** `servingAssistant`, for a caller that holds an agent id and not the row. */
export async function servingAgentId<T>(
  agentId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!agentId || !source) return fn();
  const overrides = await source.overrides();
  if (overrides.size === 0) return fn();
  return (await source.assistantId()) === agentId
    ? withSettingOverrides(overrides, fn)
    : fn();
}

/** What the Owner is told differs; empty for an installation with no source. */
export function assistantSettingDrift(): Promise<ISettingDrift[]> {
  return source ? source.drift() : Promise.resolve([]);
}

/** The source itself, for the interceptor that scopes a request. */
export function assistantSettingSource(): IAssistantSettingSource | null {
  return source;
}
