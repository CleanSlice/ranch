// @scope:api
// @slice:mcp
// @layer:application
// @type:interface
import type { Request } from 'express';

/**
 * Which tool names a caller may list and call (CLEAN-209).
 *
 * The catalogue and the tools/call handler ask this before anything else:
 * `null` means every tool, a set limits the caller to those names. The
 * template slice provides the one implementation (an agent's template may
 * carry a tool allowlist); when nothing provides it — unit tests, a Ranch
 * without templates — every tool stays listed, the same as before it existed.
 */
export abstract class CallerToolPolicy {
  abstract allowedToolsFor(httpRequest: Request): Promise<Set<string> | null>;
}
