import { shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { createServiceGetter } from '#common/composables/createServiceGetter';
import type { AgentLimitService } from '#agent/domain/agentLimit.service';
import {
  refusalCodeOf,
  type AgentLimitSaveResult,
  type IAgentLimitEntry,
  type IAgentLimits,
} from '#agent/domain/agentLimit.types';
import {
  browserPollerEnv,
  createVisiblePoller,
  type IPollerEnv,
  type IVisiblePoller,
} from '#agent/utils/visiblePoller';

// Re-export the domain types so consumers that import them from
// `#agent/stores/agentLimit` keep to one path.
export type {
  AgentLimitSaveResult,
  IAgentLimitEntry,
  IAgentLimitSummary,
  IAgentLimits,
  IAgentLoad,
  IAgentLoadMinute,
  IAgentLoadWindow,
  LimitWindowTypes,
} from '#agent/domain/agentLimit.types';

const getService = createServiceGetter<AgentLimitService>('$agentLimitService');

/** The open agent's load (FR-046: figures within 5 s of a request). */
export const LOAD_POLL_MS = 3000;
/** The list marks. */
export const SUMMARY_POLL_MS = 15000;

const UNKNOWN: IAgentLimitEntry = {
  enabled: false,
  atLimit: false,
  needsLimits: false,
};

/**
 * The store's setup, with its two outside dependencies passed in — the service
 * and the browser — so `agentLimit.test.ts` runs it with neither a Nuxt app
 * nor a real clock.
 */
export function agentLimitStoreSetup(
  service: () => AgentLimitService,
  env: IPollerEnv = browserPollerEnv,
) {
  // Single source of truth (docs/state.md): what the console knows about one
  // agent's limits lives here once. The summary, a limits read and the load
  // poll all write into the same record; the list marks, the "Visibility &
  // embed" card and the load view render it by agent id.
  //
  // Shallow on purpose: every write replaces the map and the record, never a
  // field inside one, so there is nothing deeper to track — and the rollback
  // below compares by identity, which a deep proxy would break.
  const byAgent = shallowRef<Record<string, IAgentLimitEntry>>({});

  function entry(agentId: string): IAgentLimitEntry | undefined {
    return byAgent.value[agentId];
  }

  // Merges into the record, creating it when the id is new.
  function upsert(
    agentId: string,
    partial: Partial<IAgentLimitEntry>,
  ): IAgentLimitEntry {
    const next = { ...UNKNOWN, ...byAgent.value[agentId], ...partial };
    byAgent.value = { ...byAgent.value, [agentId]: next };
    return next;
  }

  // The one road for an optimistic change. The rollback restores only the
  // fields still holding the patched value: if a poll wrote something fresher
  // while the request was in flight, undoing the guess must not undo the truth.
  function patch(
    agentId: string,
    partial: Partial<IAgentLimitEntry>,
  ): () => void {
    const previous: IAgentLimitEntry = { ...UNKNOWN, ...byAgent.value[agentId] };
    upsert(agentId, partial);
    return () => {
      const current = byAgent.value[agentId];
      if (!current) return;
      const restored: Record<string, unknown> = { ...current };
      const keys = Object.keys(partial) as (keyof IAgentLimitEntry)[];
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i]!;
        if (current[key] !== partial[key]) continue;
        if (previous[key] === undefined) delete restored[key];
        else restored[key] = previous[key];
      }
      byAgent.value = {
        ...byAgent.value,
        [agentId]: restored as unknown as IAgentLimitEntry,
      };
    };
  }

  // Flags for every agent. Only upserts: an agent that has since been deleted
  // keeps a record nothing renders, which is cheaper than racing a load read
  // for an agent the summary has not listed yet.
  async function fetchSummary() {
    const rows = await service().summary();
    const next = { ...byAgent.value };
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      next[row.agentId] = {
        ...next[row.agentId],
        enabled: row.enabled,
        atLimit: row.atLimit,
        needsLimits: row.needsLimits,
      };
    }
    byAgent.value = next;
    return rows;
  }

  async function fetchLimits(agentId: string) {
    const limits = await service().limits(agentId);
    upsert(agentId, {
      limits,
      enabled: limits !== null,
      // "Public without limits" cannot be true of an agent that has one.
      ...(limits !== null ? { needsLimits: false } : {}),
    });
    return limits;
  }

  async function fetchLoad(agentId: string) {
    const load = await service().load(agentId);
    let atLimit = false;
    for (let i = 0; i < load.windows.length; i += 1) {
      if (load.windows[i]!.retryAfterSec !== null) atLimit = true;
    }
    upsert(agentId, {
      load,
      limits: load.limits,
      enabled: load.limits !== null,
      needsLimits: load.needsLimits,
      atLimit,
    });
    return load;
  }

  /**
   * Save limits (`null` switches them off): shown at once, put back if the
   * server says no. Never throws — a refusal is an answer, with the server's
   * `code` so the caller can word it next to the field it concerns.
   *
   * `send` replaces the request for a caller whose save carries more than
   * limits: the "Visibility & embed" card sends the public flag, the origins
   * and the limits in one `PUT /agents/:id`, and still wants this record to
   * move — and to move back — with it. Without `send` the limits route is used.
   */
  async function save(
    agentId: string,
    limits: IAgentLimits | null,
    send?: () => Promise<unknown>,
  ): Promise<AgentLimitSaveResult> {
    const rollback = patch(agentId, {
      limits,
      enabled: limits !== null,
      ...(limits !== null ? { needsLimits: false } : {}),
    });
    try {
      if (send) {
        await send();
      } else {
        const saved = await service().setLimits(agentId, limits);
        upsert(agentId, { limits: saved, enabled: saved !== null });
      }
    } catch (err) {
      rollback();
      return {
        ok: false,
        code: refusalCodeOf(err),
        message: (err as Error)?.message || 'Save failed',
      };
    }
    // The save went through; what is read back replaces the guess. A failed
    // read-back leaves the guess, which is what was just saved.
    await Promise.allSettled([
      ...(send ? [fetchLimits(agentId)] : []),
      fetchSummary(),
    ]);
    return { ok: true };
  }

  // ── Polls ──────────────────────────────────────────────────────────────
  // Counted, so two components watching the same thing share one request
  // loop and the last one to leave ends it. Both stop while the tab is hidden
  // (utils/visiblePoller.ts).

  const polls = new Map<string, { poller: IVisiblePoller; watchers: number }>();

  function startPoll(
    key: string,
    intervalMs: number,
    run: () => Promise<unknown>,
  ): () => void {
    let poll = polls.get(key);
    if (!poll) {
      poll = { poller: createVisiblePoller(run, intervalMs, env), watchers: 0 };
      polls.set(key, poll);
    }
    poll.watchers += 1;
    poll.poller.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = polls.get(key);
      if (!current) return;
      current.watchers -= 1;
      if (current.watchers > 0) return;
      current.poller.stop();
      polls.delete(key);
    };
  }

  /** Keep the list marks fresh. Returns the function that stops watching. */
  function watchSummary(): () => void {
    return startPoll('summary', SUMMARY_POLL_MS, fetchSummary);
  }

  /** Keep one agent's load fresh. Returns the function that stops watching. */
  function watchLoad(agentId: string): () => void {
    return startPoll(`load:${agentId}`, LOAD_POLL_MS, () => fetchLoad(agentId));
  }

  return {
    byAgent,
    entry,
    upsert,
    patch,
    fetchSummary,
    fetchLimits,
    fetchLoad,
    save,
    watchSummary,
    watchLoad,
  };
}

export const useAgentLimitStore = defineStore('agentLimit', () =>
  agentLimitStoreSetup(getService),
);
