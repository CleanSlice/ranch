import { IUsageData, IReportUsageData } from './usage.types';

export abstract class IUsageGateway {
  /**
   * `agentName` is the agent's name at the time of the report, read by the
   * caller: it is stored with each row so the spend can still be shown by
   * name after the agent is deleted (CLEAN-261). Null when the agent could
   * not be found; a name an earlier report stored is then left as it is.
   */
  abstract report(
    agentId: string,
    data: IReportUsageData,
    agentName: string | null,
  ): Promise<void>;
  abstract findRecentForAgent(
    agentId: string,
    days: number,
  ): Promise<IUsageData[]>;
  /**
   * All usage rows that reference the given LlmCredential within the last
   * N days. Used to roll up per-credential spend across agents.
   */
  abstract findRecentForCredential(
    credentialId: string,
    days: number,
  ): Promise<IUsageData[]>;
  /**
   * Every agent's usage rows within the last N days. Used to roll up
   * workspace-wide spend for the admin usage overview.
   */
  abstract findRecentAll(days: number): Promise<IUsageData[]>;
  /**
   * Every agent's usage rows with `from <= date < to`, in the order
   * `findRecentAll` gives them. For a period that does not end today.
   *
   * With `agentIds`, the rows of those agents only (CLEAN-258): a person's
   * statistics need the days of the few agents they wrote to, and must not
   * read the installation's spend to find them. An empty list is no agent,
   * and answers nothing.
   */
  abstract findRange(
    from: Date,
    to: Date,
    agentIds?: readonly string[],
  ): Promise<IUsageData[]>;
  /**
   * The earliest day any usage was reported for, or null when there is none:
   * how far back a period can reach and still have something to show.
   */
  abstract firstRecordAt(): Promise<Date | null>;
}
