import 'reflect-metadata';

export const MCP_TOOL_AUDIENCE_METADATA_KEY = 'mcp:tool-audience';

/**
 * Who a tool is for (CLEAN-232). Decided by the party a call is made for,
 * not by the agent's token alone: see `audienceAllows` in `../tooling`.
 *
 * - `everyone`: any caller.
 * - `agent`: an agent runtime, acting for itself (its token names the agent).
 * - `person`: a signed-in person of any role, proven by a console token or
 *   an acting token.
 * - `admin`: an Owner or Admin, or an agent trusted to act as one.
 * - `owner`: the Owner, or an agent trusted to act as one.
 */
export const TOOL_AUDIENCES = [
  'everyone',
  'agent',
  'person',
  'admin',
  'owner',
] as const;

export type ToolAudienceTypes = (typeof TOOL_AUDIENCES)[number];

export function isToolAudience(value: unknown): value is ToolAudienceTypes {
  return (TOOL_AUDIENCES as readonly unknown[]).includes(value);
}

/**
 * Declares the audience of a tool class, or of one `@Tool` method when a
 * class mixes audiences (most of `UserTool` is `admin`, changing a role and
 * deleting a user are `owner`). The method's own audience wins over the
 * class's. The API refuses to boot a tool that has neither.
 *
 * On a class the metadata sits on the constructor; on a method it sits on
 * the function, next to the `@Tool` metadata, which is where the registry
 * and the specs read both.
 */
export function ToolAudience(
  audience: ToolAudienceTypes,
): ClassDecorator & MethodDecorator {
  return (
    target: object,
    _propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    const holder: unknown = descriptor ? descriptor.value : target;
    if (typeof holder !== 'function') {
      throw new Error('@ToolAudience goes on a class or on a method');
    }
    Reflect.defineMetadata(MCP_TOOL_AUDIENCE_METADATA_KEY, audience, holder);
  };
}

/**
 * The audience of one tool method: its own, else its class's, else
 * undefined. `owner` is the class (constructor) the method was found on.
 */
export function toolAudienceOf(
  owner: unknown,
  method: unknown,
): ToolAudienceTypes | undefined {
  const read = (holder: unknown): ToolAudienceTypes | undefined => {
    if (typeof holder !== 'function') return undefined;
    const value: unknown = Reflect.getMetadata(
      MCP_TOOL_AUDIENCE_METADATA_KEY,
      holder,
    );
    return isToolAudience(value) ? value : undefined;
  };
  return read(method) ?? read(owner);
}
