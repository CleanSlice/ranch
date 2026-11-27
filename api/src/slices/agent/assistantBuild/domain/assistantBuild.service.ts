import { ForbiddenException, Injectable } from '@nestjs/common';
import { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import { ITemplateGateway } from '#/agent/template/domain';
import { INJECTED_MCP_IDS } from '#/mcpServer/domain/mcpServer.seeder';
import type {
  AssistantIngredientTypes,
  IAssistantBuild,
  IAssistantBuildResolver,
} from '#/mcp/interfaces/assistant-build.interface';
import { RANCHER_TEMPLATE_ID } from '#/rancher/domain/rancher.types';
import { heldRoles, rolesAdmit } from '#/user/auth/guards/roles.guard';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import { UserRoleTypes } from '#/user/user/domain';

/** What a route answers, in `code`, for a write the rule refuses. */
export const ASSISTANT_BUILT_FROM_CODE = 'ASSISTANT_BUILT_FROM';

/** What a refusal calls each kind of ingredient. */
const NOUN: Record<AssistantIngredientTypes, string> = {
  template: 'template',
  skill: 'skill',
  mcpServer: 'tool server',
  llmCredential: 'model credential',
  knowledge: 'knowledge base',
};

/** The sentence a route answers; the consoles have their own, with the name. */
export function builtFromMessage(kind: AssistantIngredientTypes): string {
  return (
    `This ${NOUN[kind]} is part of what the Ranch assistant is built from. ` +
    'Only the Owner can change it.'
  );
}

/** The 403 every refused route answers, with a code a console can read. */
export function builtFromForbidden(
  kind: AssistantIngredientTypes,
): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    code: ASSISTANT_BUILT_FROM_CODE,
    kind,
    message: builtFromMessage(kind),
  });
}

type Bearer = Pick<IAuthTokenPayload, 'sub' | 'roles'> | null | undefined;

/**
 * What the Ranch assistant is built from, and who may change it (CLEAN-271).
 *
 * The assistant (the agent with `isAdmin`) is the Owner's alone: its row,
 * files, secrets, schedule and restart since CLEAN-232. Its pod, though, is
 * assembled at every restart from things that are not the agent
 * (`AgentDeployService.restartAgent`, `ArgoWorkflowGateway`):
 *
 *   - its template: the image, and every file under the template's prefix,
 *     copied over the agent's own at each restart (`resyncFromTemplate`);
 *   - the skills that template ships, written into the workspace by name
 *     (`syncSkillsFromTemplate`);
 *   - the tool servers that template attaches, plus the ones every agent is
 *     handed (`AgentMcpResolver`): address, transport, how to authenticate.
 *     The Ranch server is sent the assistant's own token, which carries
 *     Owner, so whoever writes its address receives that token;
 *   - the model credential its row names (`llmCredentialId`);
 *   - the knowledge bases its row names, or its template's defaults.
 *
 * An Admin could write every one of those, and the change reached the
 * assistant at its next restart: a turn that runs with the Owner's standing
 * on instructions an Admin wrote. So each of them is changed by the Owner
 * only, for as long as the assistant is built from it.
 *
 * "Built from" is answered from the rows, at the moment of the call. Nothing
 * here is a list somebody keeps: bind the assistant to another credential
 * and the old one is an ordinary credential again. One template is named by
 * the code rather than by a row: the Rancher template (`RANCHER_TEMPLATE_ID`),
 * which is what the setup makes the assistant from. It is the Owner's before
 * the assistant exists too, so that nobody prepares it for them.
 *
 * Reading stays as it was: an Admin sees templates, skills, servers and
 * credentials. Creating a new resource is not a change to the assistant
 * either, because binding it is: a new skill reaches the assistant only by
 * being attached to its template, which is a write to that template.
 *
 * Two doors use this. The MCP handler asks `ingredients()` once per call
 * (`ASSISTANT_BUILD_RESOLVER`) and notes the answer for `builtFromRefusal`.
 * The routes carry `@ChangesAssistantIngredient(kind, param)`, read by
 * `AssistantBuildGuard`, or call `assertMayChange` where the id is not in
 * the path.
 */
@Injectable()
export class AssistantBuildService implements IAssistantBuildResolver {
  constructor(
    private readonly agents: IAgentGateway,
    private readonly templates: ITemplateGateway,
  ) {}

  async ingredients(): Promise<IAssistantBuild> {
    const assistant = await this.agents.findAdmin();
    const templateIds = unique([assistant?.templateId, RANCHER_TEMPLATE_ID]);
    const templates = (
      await Promise.all(templateIds.map((id) => this.templates.findById(id)))
    ).filter((template) => template !== null);
    return {
      // An id is the assistant's template whether or not its row is there:
      // creating a template under that id is writing the assistant's.
      template: templateIds,
      skill: unique(templates.flatMap((template) => template.skillIds)),
      // The servers every agent is handed are the assistant's too, attached
      // or not, enabled or not: switching one on is a change as well.
      mcpServer: unique([
        ...templates.flatMap((template) => template.mcpServerIds),
        ...INJECTED_MCP_IDS,
      ]),
      llmCredential: unique([assistant?.llmCredentialId]),
      knowledge: unique([
        ...(assistant?.knowledgeIds ?? []),
        ...templates.flatMap((template) => template.defaultKnowledgeIds),
      ]),
    };
  }

  async isIngredient(
    kind: AssistantIngredientTypes,
    id: string | null | undefined,
  ): Promise<boolean> {
    if (typeof id !== 'string' || id === '') return false;
    return (await this.ingredients())[kind].includes(id);
  }

  /** Whether the bearer of a console request is the Owner. */
  static isOwner(user: Bearer): boolean {
    return rolesAdmit([UserRoleTypes.Owner], heldRoles(user));
  }

  /**
   * Throws the 403 when `user` is not the Owner and any of `ids` is a
   * resource of `kind` the assistant is built from. For a route whose id is
   * not a path parameter: an import that overwrites by name, an install
   * that names its template in a manifest.
   */
  async assertMayChange(
    user: Bearer,
    kind: AssistantIngredientTypes,
    ...ids: (string | null | undefined)[]
  ): Promise<void> {
    if (AssistantBuildService.isOwner(user)) return;
    const built = (await this.ingredients())[kind];
    if (ids.some((id) => typeof id === 'string' && built.includes(id))) {
      throw builtFromForbidden(kind);
    }
  }

  /**
   * `rows` with `assistantDependency` on each: what tells a console which
   * resources to show read-only to anybody but the Owner. The same for every
   * viewer, the Owner included; who may write is the role's to say.
   */
  async mark<T extends { id: string }>(
    kind: AssistantIngredientTypes,
    rows: readonly T[],
  ): Promise<(T & { assistantDependency: boolean })[]> {
    const built = new Set((await this.ingredients())[kind]);
    return rows.map((row) => ({
      ...row,
      assistantDependency: built.has(row.id),
    }));
  }

  async markOne<T extends { id: string }>(
    kind: AssistantIngredientTypes,
    row: T,
  ): Promise<T & { assistantDependency: boolean }> {
    return (await this.mark(kind, [row]))[0];
  }
}

function unique(ids: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      ids.filter((id): id is string => typeof id === 'string' && id !== ''),
    ),
  ];
}
