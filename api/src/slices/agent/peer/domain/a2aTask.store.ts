import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { IA2aTask } from './a2a.types';

/** How long a finished task stays answerable by GetTask. */
export const A2A_TASK_TTL_MS = 10 * 60_000;

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Tasks this server has answered, kept in memory (CLEAN-74, research R12).
 *
 * The protocol wants GetTask to exist; Ranch's own delegations never need it,
 * because a blocking SendMessage already hands the caller the final task. So
 * the store is a courtesy to other A2A clients, not a system of record — and
 * persisting rows nothing reads would be a table to migrate, back up and
 * explain forever. A short TTL says exactly that in code.
 */
@Injectable()
export class A2aTaskStore implements OnModuleInit, OnModuleDestroy {
  private readonly tasks = new Map<
    string,
    { task: IA2aTask; connectionId: string; expiresAt: number }
  >();

  private sweeper: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // Never hold the process open for a cache.
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    this.tasks.clear();
  }

  /** `connectionId`: the connection the task was made through. */
  put(task: IA2aTask, connectionId: string): void {
    this.tasks.set(task.id, {
      task,
      connectionId,
      expiresAt: Date.now() + A2A_TASK_TTL_MS,
    });
  }

  /**
   * The task, for the connection it was made through. Any other connection
   * gets the answer of a task that does not exist (CLEAN-236).
   */
  get(id: string, connectionId: string): IA2aTask | null {
    const entry = this.tasks.get(id);
    if (!entry || entry.connectionId !== connectionId) return null;
    if (entry.expiresAt <= Date.now()) {
      this.tasks.delete(id);
      return null;
    }
    return entry.task;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.tasks) {
      if (entry.expiresAt <= now) this.tasks.delete(id);
    }
  }
}
