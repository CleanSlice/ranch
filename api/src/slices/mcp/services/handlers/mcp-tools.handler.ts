import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Scope } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';
import { isConditionallyListed } from '../../interfaces/conditional-listing.interface';
import {
  TOOL_LISTING_RECORDER,
  type IToolListingRecorder,
} from '../../interfaces/tool-listing-recorder.interface';
import {
  ACTING_PARTY_RESOLVER,
  ACTOR_META_KEY,
  AUDIENCE_META_KEY,
  type IActingPartyResolver,
} from '../../interfaces/acting-party.interface';
import {
  AGENT_MANAGER_RESOLVER,
  type IAgentManagerResolver,
} from '../../interfaces/agent-manager.interface';
import {
  ASSISTANT_GRANT_RESOLVER,
  type IAssistantGrantResolver,
} from '../../interfaces/assistant-grant.interface';
import {
  PEER_PARTY_RESOLVER,
  TURN_META_KEY,
  type IPeerPartyResolver,
} from '../../interfaces/peer-party.interface';
import { ToolCatalogService } from '../tool-catalog.service';
import {
  audienceAllows,
  callerAgentId,
  callerIsOperator,
  callerParty,
  callerPerson,
  manageCaller,
  setCalledTool,
  setCallerAssistantGrant,
  setCallerManagesAgents,
  setCallerOwnerOnlyAgent,
  setCallerTurnClient,
  withCallerParty,
} from '../../tooling';
import type {
  IAuthTokenPayload,
  ICallerParty,
} from '#/user/auth/domain/auth.types';

/** The part of an MCP request this handler reads the stated actor from. */
interface IRequestWithMeta {
  params?: { _meta?: Record<string, unknown> };
}

@Injectable({ scope: Scope.REQUEST })
export class McpToolsHandler extends McpHandlerBase {
  private readonly catalog: ToolCatalogService;

  constructor(moduleRef: ModuleRef, registry: McpRegistryService) {
    super(moduleRef, registry, McpToolsHandler.name);
    // The executor builds this handler by hand, so the catalogue is looked
    // up rather than injected. It has to be the application's one catalogue:
    // slices register their caller tool policies on it at start (CLEAN-240),
    // and a catalogue built here would know none of them, so what a setting
    // took away would still be listed and run (CLEAN-254). Built by hand
    // only where no application provides one, as in a unit spec.
    this.catalog =
      this.sharedCatalog() ?? new ToolCatalogService(moduleRef, registry);
  }

  private sharedCatalog(): ToolCatalogService | undefined {
    try {
      const shared = this.moduleRef.get(ToolCatalogService, { strict: false });
      return shared instanceof ToolCatalogService ? shared : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The request one call sees: the transport's HTTP request, plus the party
   * this call is made for (CLEAN-232).
   *
   * In stateful mode one MCP session serves many calls, for different people
   * and possibly at once, and the handlers are re-registered with whichever
   * HTTP request arrived last. So the party is never written onto that
   * request: each tools/list and tools/call gets its own view of it
   * (`withCallerParty`), and the tool, the catalogue and the listing hooks
   * are all handed that view.
   *
   * The actor is what the runtime states in `_meta["ranch/actor"]`; the
   * resolver decides what it is worth. No resolver, or one that throws, is a
   * guest for an agent's token. A person's own console token still speaks
   * for that person: `callerParty` reads that from the bearer.
   *
   * An actor of the kind `peer` is another agent's question, handed over
   * through a connection (CLEAN-236). The peer slice reads its token; what
   * does not check out is a guest, as everywhere.
   *
   * `_meta["ranch/turn"]` says which conversation of the runtime the call
   * belongs to. It is noted on the view for `ask_agent` to route its
   * progress step by, and grants nothing.
   *
   * `calledTool` is the name tools/call looked the tool up by; tools/list
   * has none. It is noted on the view so that a permission asked inside the
   * tool is about that tool and no other (CLEAN-254).
   */
  private async callRequestFor(
    httpRequest: Request,
    mcpRequest: IRequestWithMeta | undefined,
    calledTool?: string,
  ): Promise<Request> {
    const stated = mcpRequest?.params?._meta?.[ACTOR_META_KEY];
    const actor =
      typeof stated === 'object' && stated !== null
        ? (stated as { kind?: unknown; token?: unknown })
        : undefined;
    const bearer = (httpRequest as Request & { user?: IAuthTokenPayload })
      ?.user;

    let resolver: IActingPartyResolver | undefined;
    try {
      resolver = this.moduleRef.get<IActingPartyResolver>(
        ACTING_PARTY_RESOLVER,
        { strict: false },
      );
    } catch {
      resolver = undefined;
    }

    let party: ICallerParty | undefined;
    if (actor?.kind === 'peer') {
      party = await this.peerPartyFor(bearer, actor.token);
    } else if (resolver && typeof resolver.resolve === 'function') {
      try {
        party = await resolver.resolve(bearer, actor);
      } catch (e) {
        this.logger.warn(
          `acting party could not be resolved, falling back to the bearer alone: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    // Without an answer, fall back to what the bearer alone proves: a person
    // for a console token, a guest for an agent's.
    const view = withCallerParty(
      httpRequest,
      party ?? callerParty(httpRequest),
    );
    const turn = mcpRequest?.params?._meta?.[TURN_META_KEY];
    const client =
      typeof turn === 'object' && turn !== null
        ? (turn as { client?: unknown }).client
        : undefined;
    if (typeof client === 'string' && client) {
      setCallerTurnClient(view, client);
    }
    if (calledTool) setCalledTool(view, calledTool);
    await this.noteManagedAgents(view);
    await this.noteAssistantGrant(view);
    return view;
  }

  /**
   * The party of a call that states a hand-over. Only an agent's own token
   * can carry one; a missing resolver, a throw, or a token that does not
   * check out all come to the same thing, a guest.
   */
  private async peerPartyFor(
    bearer: IAuthTokenPayload | undefined,
    token: unknown,
  ): Promise<ICallerParty> {
    try {
      const resolver = this.moduleRef.get<IPeerPartyResolver>(
        PEER_PARTY_RESOLVER,
        { strict: false },
      );
      if (resolver && typeof resolver.resolvePeer === 'function') {
        return await resolver.resolvePeer(bearer, token);
      }
    } catch (e) {
      this.logger.warn(
        `peer party could not be resolved, treating the call as a guest's: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return { kind: 'guest' };
  }

  /**
   * The `manage-agent` tools are for whoever manages at least one agent. For
   * an operator that is always so and nothing is asked. For a person below
   * Admin it is a fact about the agents they created, which only the agent
   * slice knows: ask once per call and note the answer on the call's view,
   * where `audienceAllows` reads it. No resolver, or one that throws, leaves
   * the answer at no.
   */
  private async noteManagedAgents(callRequest: Request): Promise<void> {
    const person = callerPerson(callRequest);
    if (!person || callerIsOperator(callRequest)) return;
    let manages = false;
    try {
      const resolver = this.moduleRef.get<IAgentManagerResolver>(
        AGENT_MANAGER_RESOLVER,
        { strict: false },
      );
      manages =
        typeof resolver?.managesAny === 'function' &&
        (await resolver.managesAny(person)) === true;
    } catch (e) {
      this.logger.warn(
        `could not tell whether user ${person.userId} manages an agent: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    setCallerManagesAgents(callRequest, manages);
  }

  /**
   * A person below Admin may hold single `manage-agent` tools through the
   * assistant setting (CLEAN-254). Which ones is a fact about that setting
   * and about which agent is the assistant, and only the assistantAccess
   * slice knows both: ask once per call and note the answer on the call's
   * view, where `audienceAllows` and `manageCaller` read it.
   *
   * Asked for a person named by an agent's token only: a console token has
   * no assistant behind it, and an operator has these tools already. Of the
   * names that come back, only those the registry holds with the audience
   * `manage-agent` are kept, so the answer can open nothing else. No
   * resolver, or one that throws, leaves nothing granted.
   */
  private async noteAssistantGrant(callRequest: Request): Promise<void> {
    const person = callerPerson(callRequest);
    if (!person || callerIsOperator(callRequest)) return;
    if (callerAgentId(callRequest) === null) return;
    let granted: string[] = [];
    try {
      const resolver = this.moduleRef.get<IAssistantGrantResolver>(
        ASSISTANT_GRANT_RESOLVER,
        { strict: false },
      );
      const names =
        typeof resolver?.grantedToolsFor === 'function'
          ? await resolver.grantedToolsFor(callRequest)
          : null;
      if (names instanceof Set) {
        granted = this.registry
          .getTools()
          .filter(
            (tool) =>
              tool.audience === 'manage-agent' && names.has(tool.metadata.name),
          )
          .map((tool) => tool.metadata.name);
      }
    } catch (e) {
      granted = [];
      this.logger.warn(
        `could not tell what the assistant setting gives user ${person.userId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    setCallerAssistantGrant(callRequest, granted);
  }

  /**
   * A `manage-agent` tool answers "not found" for an agent the caller may
   * not manage, and for one agent that is a lie the person can see through:
   * the Ranch assistant, which they are talking to and which only the Owner
   * manages (CLEAN-263). Whether this caller is such a person is a fact
   * about roles and reach, so the agent slice is asked, once per call of
   * such a tool, and the answer noted on the call's view, where
   * `agentNotFound` reads it.
   *
   * Asked as `manageCaller` sees the caller, the same party the tool will
   * ask `manageable` about. Nothing is noted for anybody but a person; no
   * resolver, or one that throws, leaves nothing noted and the refusal at
   * not-found.
   */
  private async noteOwnerOnlyAgent(callRequest: Request): Promise<void> {
    const caller = manageCaller(callRequest);
    if (caller.kind !== 'person') return;
    let agent: { id: string; name: string } | null = null;
    try {
      const resolver = this.moduleRef.get<IAgentManagerResolver>(
        AGENT_MANAGER_RESOLVER,
        { strict: false },
      );
      agent =
        typeof resolver?.ownerOnlyAgentFor === 'function'
          ? await resolver.ownerOnlyAgentFor(caller)
          : null;
    } catch (e) {
      agent = null;
      this.logger.warn(
        `could not tell whether user ${caller.userId} reaches the Ranch assistant: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    setCallerOwnerOnlyAgent(callRequest, agent);
  }

  /**
   * Fire-and-forget. Only agent runtimes are recorded (a person listing
   * through the console has no pod), and neither a missing recorder nor a
   * failed write may touch the listing itself.
   *
   * Only a listing made for the agent itself (a `trusted` party) is kept:
   * that is the view the console's catalogue compares against. A listing
   * made for a person or a guest is that party's subset, and recording it
   * would mark every other tool as missing from the pod.
   */
  private recordListing(httpRequest: Request, toolNames: string[]): void {
    const agentId = callerAgentId(httpRequest);
    if (!agentId) return;
    if (callerParty(httpRequest).kind !== 'trusted') return;
    let recorder: IToolListingRecorder | undefined;
    try {
      recorder = this.moduleRef.get<IToolListingRecorder>(
        TOOL_LISTING_RECORDER,
        { strict: false },
      );
    } catch {
      return;
    }
    if (!recorder || typeof recorder.record !== 'function') return;
    void Promise.resolve()
      .then(() => recorder.record(agentId, toolNames))
      .catch((e: unknown) => {
        this.logger.warn(
          `tool listing snapshot failed for agent ${agentId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      });
  }

  registerHandlers(mcpServer: McpServer, httpRequest: Request) {
    mcpServer.server.setRequestHandler(
      ListToolsRequestSchema,
      async (request) => {
        const callRequest = await this.callRequestFor(httpRequest, request);

        // The per-caller list (audience, conditional listing, dynamic
        // descriptions) is computed by ToolCatalogService so the console's
        // catalogue endpoint and this handler can never disagree (CLEAN-109).
        const listed = await this.catalog.listFor(callRequest);

        // What the pod was told for itself is what it believes it has. Hand
        // the names to the recorder, if one is wired, so the console can
        // later tell a tool the pod has from one it lacks.
        this.recordListing(
          callRequest,
          listed.map((t) => t.name),
        );

        return {
          tools: listed.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            _meta: { [AUDIENCE_META_KEY]: tool.audience },
          })),
        };
      },
    );

    mcpServer.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const toolInfo = this.registry.findTool(request.params.name);

        if (!toolInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`,
          );
        }

        const notAvailable = () => ({
          content: [
            {
              type: 'text' as const,
              text: `Tool "${request.params.name}" is not available to this caller.`,
            },
          ],
          isError: true,
        });

        try {
          const callRequest = await this.callRequestFor(
            httpRequest,
            request,
            toolInfo.metadata.name,
          );

          // First lock: the audience. A name the caller was never listed is
          // refused exactly like one that stopped applying, before the tool
          // is even resolved (CLEAN-232). The name is part of the question:
          // a `manage-agent` tool may be one the assistant setting gave this
          // person, and that is decided tool by tool (CLEAN-254).
          if (
            !audienceAllows(
              toolInfo.audience,
              callRequest,
              toolInfo.metadata.name,
            )
          ) {
            return notAvailable();
          }
          if (toolInfo.audience === 'manage-agent') {
            await this.noteOwnerOnlyAgent(callRequest);
          }

          const contextId = ContextIdFactory.getByRequest(callRequest);
          this.moduleRef.registerRequestByContextId(callRequest, contextId);

          const toolInstance = await this.moduleRef.resolve(
            toolInfo.providerClass,
            contextId,
            { strict: false },
          );

          const context = this.createContext(mcpServer, request);

          if (!toolInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`,
            );
          }

          // The caller's template may limit which tools its agents get
          // (CLEAN-209); a name outside the list is refused like a hidden one.
          const allowed = await this.catalog.allowedNamesFor(callRequest);
          if (allowed && !allowed.has(request.params.name)) {
            return notAvailable();
          }
          // A pod lists tools once at connect and caches them, so a caller
          // can hold a name that stopped applying to it since. Refuse here
          // rather than run it: for ask_agent that is the difference between
          // "you have no peers" and delegating through a removed connection.
          if (isConditionallyListed(toolInstance)) {
            const listedForCaller =
              await toolInstance.isListedForRequest(callRequest);
            if (!listedForCaller) return notAvailable();
          }

          const result = await toolInstance[toolInfo.methodName].call(
            toolInstance,
            request.params.arguments,
            context,
            callRequest,
          );

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result;
        } catch (error) {
          this.logger.error(
            `[MCP Tools] Tool execution error: ${request.params.name}`,
            error,
          );
          return {
            content: [{ type: 'text', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }
}
