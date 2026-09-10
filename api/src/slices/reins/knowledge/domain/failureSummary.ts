/** How many failures the base's own error line names before pointing at the table. */
export const FAILURE_SUMMARY_LIMIT = 5;

export interface IFailureLine {
  name: string;
  error: string | null;
}

/**
 * The one-line `indexError` of a base after a run. It names the first few
 * failed sources and says how many more there are: an ellipsis at the end read
 * as a truncated string (a reviewer asked whether the API had a length limit),
 * and the full list has a home of its own, the Sources tab filtered by Failed.
 */
export function summarizeFailures(failures: IFailureLine[]): string | null {
  if (failures.length === 0) return null;
  const shown = failures
    .slice(0, FAILURE_SUMMARY_LIMIT)
    .map((f) => `${f.name} (${f.error ?? 'unknown error'})`)
    .join('; ');
  const rest = failures.length - FAILURE_SUMMARY_LIMIT;
  const tail =
    rest > 0
      ? `; and ${rest} more, all listed under Sources > Failed`
      : '';
  return `${failures.length} source(s) failed: ${shown}${tail}`;
}
