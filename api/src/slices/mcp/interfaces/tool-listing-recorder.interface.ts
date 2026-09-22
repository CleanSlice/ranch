/**
 * Optional hook the MCP tools handler calls after serving tools/list to an
 * agent runtime (CLEAN-109). A pod lists once at boot, so the names it was
 * given are what it believes it has; whoever provides this token can keep
 * that snapshot and later tell a tool the pod has from one it lacks.
 *
 * Resolved with `strict: false` and a try/catch: the mcp slice does not
 * depend on the provider, and a missing or failing recorder never breaks a
 * listing.
 */
export const TOOL_LISTING_RECORDER = Symbol('TOOL_LISTING_RECORDER');

export interface IToolListingRecorder {
  record(agentId: string, toolNames: string[]): Promise<void>;
}
