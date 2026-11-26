const HOUR_MS = 3_600_000;

/** What of a message decides its bucket: who sent it and when (unix ms). */
export interface IActivityMessage {
  role: string;
  ts: number;
}

/** The messages of one conversation in one UTC hour (CLEAN-261). */
export interface IActivityBucket {
  /** Start of the hour, UTC. */
  hour: Date;
  userMessages: number;
  agentMessages: number;
}

/**
 * The UTC hour a moment falls in. Unix time has no zone and every UTC hour is
 * 3 600 000 ms of it, so this is arithmetic: no calendar, no DST, and the same
 * answer on a machine in any zone. The live write and the settle pass both
 * key their rows with it, which is what lets one repair the other.
 */
export function hourOf(ts: number): Date {
  return new Date(Math.floor(ts / HOUR_MS) * HOUR_MS);
}

/**
 * Messages counted per UTC hour, oldest hour first: the person's (`user`) and
 * the agent's (`assistant`). Every other role is not a message somebody sent,
 * and is left out, as is a line whose time is not a moment. An hour without a
 * message has no row.
 */
export function bucketByHour(
  messages: readonly IActivityMessage[],
): IActivityBucket[] {
  const byHour = new Map<number, IActivityBucket>();
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!Number.isFinite(message.ts)) continue;
    const hour = hourOf(message.ts);
    let bucket = byHour.get(hour.getTime());
    if (!bucket) {
      bucket = { hour, userMessages: 0, agentMessages: 0 };
      byHour.set(hour.getTime(), bucket);
    }
    if (message.role === 'user') bucket.userMessages++;
    else bucket.agentMessages++;
  }
  return [...byHour.values()].sort(
    (a, b) => a.hour.getTime() - b.hour.getTime(),
  );
}
