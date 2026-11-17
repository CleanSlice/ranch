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
import { ToolCatalogService } from '../tool-catalog.service';
import {
  audienceAllows,
  callerAgentId,
  callerParty,
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
    // Constructed rather than injected: the executor builds this handler by
    // hand, and the service is stateless over the same two dependencies.
    this.catalog = new ToolCatalogService(moduleRef, registry);
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
   */
  private async callRequestFor(
    httpRequest: Request,
    mcpRequest: IRequestWithMeta | undefined,
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
    if (resolver && typeof resolver.resolve === 'function') {
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
    return withCallerParty(httpRequest, party ?? callerParty(httpRequest));
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
          const callRequest = await this.callRequestFor(httpRequest, request);

          // First lock: the audience. A name the caller was never listed is
          // refused exactly like one that stopped applying, before the tool
          // is even resolved (CLEAN-232).
          if (!audienceAllows(toolInfo.audience, callRequest)) {
            return notAvailable();
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
