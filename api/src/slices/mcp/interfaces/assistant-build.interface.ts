/**
 * What the Ranch assistant is built from (CLEAN-271).
 *
 * The assistant is the Owner's alone to manage (CLEAN-232, CLEAN-263). That
 * was true of the agent and not of its ingredients: an Admin could rewrite
 * the template its instructions are copied from, a skill that template
 * ships, the address of a tool server it is handed its token for, or the
 * model credential it runs on, and the change landed at its next restart, in
 * a turn that runs with the Owner's standing. So a resource the assistant is
 * built from is changed by the Owner only.
 *
 * Which resources those are is read off the data at the moment of the call
 * (the assistant's row, its template, what the template ships), never off a
 * list of ids somebody keeps. The agent slice knows; the MCP handler asks it
 * once per call through this token and notes the answer on the call's
 * request, where `builtFromRefusal` (`#/mcp/tooling`) reads it. So a tool
 * needs no new dependency, and the mcp slice does not import the agent
 * slice.
 */
export const ASSISTANT_BUILD_RESOLVER = Symbol('ASSISTANT_BUILD_RESOLVER');

/** The kinds of resource an agent's pod is assembled from. */
export type AssistantIngredientTypes =
  | 'template'
  | 'skill'
  | 'mcpServer'
  | 'llmCredential'
  | 'knowledge';

export const ASSISTANT_INGREDIENT_KINDS: readonly AssistantIngredientTypes[] = [
  'template',
  'skill',
  'mcpServer',
  'llmCredential',
  'knowledge',
];

/** The ids the assistant is built from now, by kind. */
export type IAssistantBuild = Record<
  AssistantIngredientTypes,
  readonly string[]
>;

export interface IAssistantBuildResolver {
  ingredients(): Promise<IAssistantBuild>;
}
