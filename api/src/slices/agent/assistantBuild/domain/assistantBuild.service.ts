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
 * What stands where a secret of the assistant's ingredients would be, for
 * anybody but the Owner. A fixed string: never a prefix, a suffix or the
 * length of the real value.
 */
export const WITHHELD_SECRET = '(withheld: only the Owner can read it)';

/** The field of each kind that holds a secret. */
const SECRET_FIELD: Partial<Record<AssistantIngredientTypes, string>> = {
  llmCredential: 'apiKey',
  mcpServer: 'authValue',
};

/** `row` with its secret field replaced, when it holds one. */
function withheld<T extends object>(kind: AssistantIngredientTypes, row: T): T {
  const field = SECRET_FIELD[kind];
  if (!field) return row;
  const value = (row as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value === '') return row;
  return { ...row, [field]: WITHHELD_SECRET };
}

/** One entry of `MCP_SERVERS_B64`, as much of it as is read here. */
interface IRuntimeServer {
  id?: unknown;
  authValue?: unknown;
}

/**
 * `MCP_SERVERS_B64` with the credential of each server in `ids` withheld.
 * The value is base64 of the JSON the pod boots with; a value that does not
 * decode to a list is withheld whole rather than passed on unread.
 */
export function withholdServerAuth(
  encoded: string,
  ids: ReadonlySet<string>,
): string {
  let servers: unknown;
  try {
    servers = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return WITHHELD_SECRET;
  }
  if (!Array.isArray(servers)) return WITHHELD_SECRET;
  const masked = (servers as IRuntimeServer[]).map((server) =>
    typeof server?.id === 'string' &&
    ids.has(server.id) &&
    typeof server.authValue === 'string' &&
    server.authValue !== ''
      ? { ...server, authValue: WITHHELD_SECRET }
      : server,
  );
  return Buffer.from(JSON.stringify(masked)).toString('base64');
}

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
   * `rows` as `viewer` reads them: `assistantDependency` on each, which
   * tells a console what to show read-only to anybody but the Owner, and the
   * secret of each ingredient withheld from anybody but the Owner.
   *
   * The mark is the same for every viewer. The secret is not: the key the
   * assistant runs on and the credential of a server it is handed were sent
   * in full to every Admin who listed credentials or servers (CLEAN-271).
   * Not being able to change a key is little use while one can read it. An
   * ordinary credential or server is sent as before: an Admin manages it.
   *
   * `viewer` is required on purpose: a caller that forgot it would send
   * the secret.
   */
  async mark<T extends { id: string }>(
    kind: AssistantIngredientTypes,
    rows: readonly T[],
    viewer: Bearer,
  ): Promise<(T & { assistantDependency: boolean })[]> {
    const built = new Set((await this.ingredients())[kind]);
    const owner = AssistantBuildService.isOwner(viewer);
    return rows.map((row) => {
      const assistantDependency = built.has(row.id);
      return {
        ...(assistantDependency && !owner ? withheld(kind, row) : row),
        assistantDependency,
      };
    });
  }

  async markOne<T extends { id: string }>(
    kind: AssistantIngredientTypes,
    row: T,
    viewer: Bearer,
  ): Promise<T & { assistantDependency: boolean }> {
    return (await this.mark(kind, [row], viewer))[0];
  }

  /**
   * The env preview of `agent` as `viewer` reads it. An ordinary agent may
   * run on the credential the assistant runs on, or be handed a server the
   * assistant is handed (one key for the whole Ranch is the common case):
   * its preview would then carry the assistant's secret to whoever manages
   * that agent. For anybody but the Owner those values are withheld; the
   * rest of the preview is as it was.
   */
  async envFor<T extends { name: string; value: string }>(
    agent: { llmCredentialId: string | null },
    env: readonly T[],
    viewer: Bearer,
  ): Promise<T[]> {
    if (AssistantBuildService.isOwner(viewer)) return [...env];
    return withholdEnv(agent, env, await this.ingredients());
  }

  /**
   * The servers of an agent as a person reads them: the credential of one
   * the assistant is handed is withheld from anybody but the Owner. Not for
   * the runtime reading its own list, which needs the values.
   */
  async serversFor<T extends { id: string; authValue: string | null }>(
    servers: readonly T[],
    viewer: Bearer,
  ): Promise<T[]> {
    if (AssistantBuildService.isOwner(viewer)) return [...servers];
    const built = new Set((await this.ingredients()).mcpServer);
    return servers.map((server) =>
      built.has(server.id) ? withheld('mcpServer', server) : server,
    );
  }
}

/** The names of the env vars that carry the model credential's key. */
const LLM_KEY_VARS = new Set(['LLM_API_KEY', 'LLM_AUX_API_KEY']);

/**
 * `env` with what belongs to the assistant's ingredients withheld: the key,
 * when `agent` runs on the assistant's credential, and inside
 * `MCP_SERVERS_B64` the credential of each server the assistant is handed.
 * Pure, so the tool that shows the same preview applies the same cut from
 * the ids the MCP handler noted.
 */
export function withholdEnv<T extends { name: string; value: string }>(
  agent: { llmCredentialId: string | null },
  env: readonly T[],
  build: Pick<IAssistantBuild, 'llmCredential' | 'mcpServer'>,
): T[] {
  const sharesKey =
    agent.llmCredentialId !== null &&
    build.llmCredential.includes(agent.llmCredentialId);
  const servers = new Set(build.mcpServer);
  return env.map((entry) => {
    if (!entry.value) return entry;
    if (sharesKey && LLM_KEY_VARS.has(entry.name)) {
      return { ...entry, value: WITHHELD_SECRET };
    }
    if (entry.name === 'MCP_SERVERS_B64') {
      return { ...entry, value: withholdServerAuth(entry.value, servers) };
    }
    return entry;
  });
}

function unique(ids: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      ids.filter((id): id is string => typeof id === 'string' && id !== ''),
    ),
  ];
}
