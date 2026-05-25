// @scope:api
// @slice:mcp
// @layer:application
// @type:interface

import type { Request } from 'express';

/**
 * Tools may implement this to enrich their MCP description with per-request
 * context (e.g. listing data the caller is authorised to access). The MCP
 * tools/list handler calls describeForRequest on every resolved tool that
 * implements this; a non-null return overrides the static description from
 * the @Tool decorator, null falls back to the static one.
 */
export interface IDynamicallyDescribedTool {
  describeForRequest(httpRequest: Request): Promise<string | null>;
}

export function isDynamicallyDescribed(
  value: unknown,
): value is IDynamicallyDescribedTool {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.describeForRequest === 'function';
}
