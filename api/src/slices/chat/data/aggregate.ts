import { Prisma } from '@prisma/client';
import { PrismaService } from '#/setup/prisma/prisma.service';

// How this slice runs a statement that passes over many rows to answer a
// few (CLEAN-265): the installation's activity (`ChatActivityGateway`) and,
// since the review of CLEAN-270, how much each topic is used
// (`ChatTopicGateway`). One helper and one queue for both, here and not in
// either gateway, so that the limit below is a limit on all of them
// together: two queues of two would be four connections.

/**
 * Memory one of these statements may hash in, set for its transaction only.
 *
 * Counting conversations is a hash of one entry per conversation of the
 * period, about 170 bytes each. Under the server's default of 4 MB the 245 000
 * conversations of a 90-day period in an installation of a million spilled
 * to disk in 17 passes and took 6.3 s; in memory the same statement takes
 * 0.3 s (measured, CLEAN-265). 64 MB, which Postgres doubles for a hash,
 * holds about 750 000 conversations in one period. Past that it spills again:
 * slower, never wrong. Local to the transaction, so the server's setting and
 * every other query keep what they had.
 *
 * It is a ceiling, not an allocation: the topic statement hashes one entry
 * per topic and uses a sliver of it.
 */
export const AGGREGATE_WORK_MEM = '64MB';

/**
 * How long one of these statements may run, and wait for a connection. The
 * first read after a restart finds nothing cached and scans the table from
 * disk; the default of five seconds would end that with an error on a page
 * that a second try shows.
 */
export const AGGREGATE_TIMEOUT_MS = 30_000;

/**
 * How many of these statements run at once in the process: two, the pair one
 * view asks for, so a single view still runs its two side by side and the
 * next view waits for a place.
 *
 * Each statement holds a connection of the Prisma pool for as long as it
 * runs, up to `AGGREGATE_TIMEOUT_MS`, and may hash in `AGGREGATE_WORK_MEM`,
 * which Postgres doubles: 128 MB each. Nothing capped how many ran, so a few
 * operators switching between 7, 30 and 90 days could hold the whole pool
 * while chat and sign-in waited for a connection (second review,
 * CLEAN-265). The API is one process by design: the hub, chat routing and
 * MCP sessions live in its memory (`ApiInstanceService`, CLEAN-140). So a
 * limit kept here is a limit on the installation. With two, the aggregates
 * take at most two connections and 256 MB, whoever is clicking.
 */
export const AGGREGATE_CONCURRENCY = 2;

/**
 * Places for `limit` tasks at a time, given out in the order they were asked
 * for. A task that ends, either way, hands its place to the one that has
 * waited longest, and frees it only when nobody waits: a newcomer cannot
 * slip in between an ending and the turn of the next in line.
 */
class Turns {
  private taken = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.taken < this.limit) {
      this.taken += 1;
    } else {
      // Resolved by the task that hands its place over, so `taken` already
      // counts this one when it wakes.
      await new Promise<void>((next) => this.waiting.push(next));
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.taken -= 1;
    }
  }
}

/** One queue for the process: every aggregate of every request is in it. */
const aggregateTurns = new Turns(AGGREGATE_CONCURRENCY);

/**
 * Run one aggregate with the two settings it needs, both made with
 * `set_config(…, true)`: that lasts until the transaction ends, so it has
 * to be in the same transaction as the statement, and it never reaches the
 * next user of the connection.
 *
 * `work_mem` is the memory to hash in (`AGGREGATE_WORK_MEM`).
 *
 * `plan_cache_mode = force_custom_plan` keeps the plan made for the values
 * asked. The statement is prepared once per connection, and after its
 * fifth run Postgres may stop planning for the values and keep one plan
 * for any: not knowing how much of the table two unknown dates span, it
 * picked a plan that took 5.5 s where the first five runs took 0.6 s
 * (measured at a million conversations, CLEAN-265). Nothing but a sixth
 * request shows it, so no single `EXPLAIN` does.
 *
 * The statement first waits for its turn (`AGGREGATE_CONCURRENCY`), and
 * the transaction is opened only then. So `maxWait` counts the wait for a
 * connection and `timeout` the run, each from the statement's own turn:
 * neither counts the time spent in the queue, and a statement is not
 * ended for having waited behind others. What bounds that wait is the
 * ones ahead, each of which ends within its own timeout.
 */
export function runAggregate<T>(
  prisma: PrismaService,
  statement: Prisma.Sql,
): Promise<T[]> {
  return aggregateTurns.run(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('work_mem', ${AGGREGATE_WORK_MEM}, true), set_config('plan_cache_mode', 'force_custom_plan', true)`;
        return tx.$queryRaw<T[]>(statement);
      },
      { maxWait: AGGREGATE_TIMEOUT_MS, timeout: AGGREGATE_TIMEOUT_MS },
    ),
  );
}
