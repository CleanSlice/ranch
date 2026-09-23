import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';

/**
 * Shared helpers for every `*.tool.ts` (CLEAN-109). One vocabulary for what a
 * tool hands back, who is calling, and how a destructive tool asks for a
 * confirmation it cannot see for itself. `agent/peer/toolSupport.ts` re-exports
 * the shared part so the peer tools read exactly as before.
 */

/** What an MCP tool hands back. The shape the SDK expects, nothing more. */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export const ok = (value: unknown): ToolResult => ({
  content: [
    {
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});

export const err = (text: string): ToolResult => ({
  content: [{ type: 'text', text }],
  isError: true,
});

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** Agent service tokens carry `sub = agent:<id>`; anything else is not an agent. */
export function callerAgentId(httpRequest: Request): string | null {
  const user = (httpRequest as AuthedRequest).user;
  const sub = user?.sub ?? '';
  if (!sub.startsWith('agent:')) return null;
  return sub.slice('agent:'.length);
}

/** Admin agents hold the Owner role; plain agents hold `Agent` (auth.service). */
export function callerIsOperator(httpRequest: Request): boolean {
  const user = (httpRequest as AuthedRequest).user;
  return (user?.roles ?? []).includes(UserRoleTypes.Owner);
}

export const OPERATOR_REFUSAL =
  'This tool requires the Ranch operator role. Ask the operator to do it ' +
  'in the console, or through the Ranch admin agent.';

/**
 * Third lock for operator-only tools: the listing hook hides them and
 * tools/call refuses a name that stopped applying, this refuses the body.
 */
export function requireOperator(httpRequest: Request): void {
  if (!callerIsOperator(httpRequest)) {
    throw new ForbiddenException(OPERATOR_REFUSAL);
  }
}

export const AGENT_ONLY_REFUSAL =
  'This tool can only be called by an agent runtime.';

/** Self-service tools act for the calling agent; a person has no "self" here. */
export function requireAgent(httpRequest: Request): string {
  const agentId = callerAgentId(httpRequest);
  if (!agentId) throw new ForbiddenException(AGENT_ONLY_REFUSAL);
  return agentId;
}

export const CONFIRM_SENTENCE =
  'Ask the person to confirm first; call only after they said yes, with confirm: true.';

/**
 * The API cannot see the chat, so a destructive tool proves the person agreed
 * with a required `confirm: true`. Returns the refusal to hand back, or null
 * when the call may proceed. `what` is what the tool is about to do, in the
 * words the person would read: "delete agent «support-bot» and its workspace".
 */
export function confirmed(
  args: { confirm?: unknown },
  what: string,
): ToolResult | null {
  if (args.confirm === true) return null;
  return err(
    `This will ${what}. Ask the person to confirm, then call again with confirm: true.`,
  );
}

const SECRET_KEYS = [
  'apiKey',
  'authValue',
  'oauthClientId',
  'clientSecret',
  'password',
  'passwordHash',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'keyHash',
  'cookies',
  'privateKey',
  'value',
] as const;

const DEFAULT_SECRET_KEYS: readonly string[] = SECRET_KEYS.filter(
  (k) => k !== 'value',
);

/**
 * Strip secret-bearing fields from a value before it becomes tool output
 * (FR-004). Recurses into arrays and plain objects. The default set (every
 * name Ranch uses for a credential) is ALWAYS stripped; `extraKeys` adds
 * more for a slice's own field names. `value` is only stripped when asked
 * for, since most rows have an innocent `value`.
 */
export function stripSecrets<T>(input: T, extraKeys: readonly string[] = []): T {
  const keys = new Set<string>([...DEFAULT_SECRET_KEYS, ...extraKeys]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        if (keys.has(key)) continue;
        out[key] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
}
