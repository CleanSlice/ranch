/**
 * The rows behind the API's own presence (CLEAN-140): one per live process.
 * Times come in from the caller so the service, not the database clock,
 * decides what "live" means — and so tests can move the clock.
 */
export abstract class IApiInstanceGateway {
  /** Insert this process's row, or refresh its `lastSeenAt`. */
  abstract heartbeat(id: string, hostname: string, at: Date): Promise<void>;

  /** How many rows were seen at or after `since`. */
  abstract countLive(since: Date): Promise<number>;

  /** This process is going away: drop its row. Missing is fine. */
  abstract remove(id: string): Promise<void>;

  /** Rows nobody refreshed since `before` belong to processes that died. */
  abstract pruneBefore(before: Date): Promise<number>;
}
