// @scope:api
// @slice:mcp
// @layer:application
// @type:interface

import type { Request } from 'express';

/**
 * Tools may implement this to disappear entirely for callers they do not
 * apply to. The MCP tools/list handler asks every tool that implements it and
 * omits the ones that answer false; tools/call refuses the same tools.
 *
 * Existing tools all answer "not for you" at call time, with an error string
 * the model reads only after wasting a turn on it. That is the right shape for
 * a tool that merely refuses some arguments. It is the wrong shape for a tool
 * whose very presence is a claim about the agent — `ask_agent` offered to an
 * agent with no peers advertises colleagues it does not have (CLEAN-74,
 * FR-017), and no amount of description text un-advertises them.
 *
 * A tool that throws here stays listed: a broken check must not silently
 * remove a working tool.
 */
export interface IConditionallyListedTool {
  isListedForRequest(httpRequest: Request): Promise<boolean>;
}

export function isConditionallyListed(
  value: unknown,
): value is IConditionallyListedTool {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.isListedForRequest === 'function';
}
