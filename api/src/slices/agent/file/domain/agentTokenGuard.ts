import { ForbiddenException } from '@nestjs/common';

/**
 * Direct file writes are for people at the console (CLEAN-112, FR-018).
 * An agent — Rancher included, Owner role and all — must go through
 * `write_agent_file` / `create_agent_file` / `import_agent_files`, whose
 * first call proposes and whose confirming call names the proposal. Without
 * this an agent could `curl` the REST route with its own token and skip the
 * card; the screenshot that prompted it showed Rancher trying exactly that.
 */
export const AGENT_DIRECT_WRITE_REFUSAL =
  'Agents do not write workspace files over REST. Use write_agent_file, ' +
  'create_agent_file or import_agent_files: the person sees the change and ' +
  'confirms it.';

export function refuseAgentWrite(
  req: { user?: { sub?: string } } | undefined,
): void {
  const sub = req?.user?.sub ?? '';
  if (sub.startsWith('agent:')) {
    throw new ForbiddenException(AGENT_DIRECT_WRITE_REFUSAL);
  }
}
