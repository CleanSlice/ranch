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
import { ToolCatalogService } from '../tool-catalog.service';
import { callerAgentId } from '../../tooling';

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
   * Fire-and-forget. Only agent runtimes are recorded (a person listing
   * through the console has no pod), and neither a missing recorder nor a
   * failed write may touch the listing itself.
   */
  private recordListing(httpRequest: Request, toolNames: string[]): void {
    const agentId = callerAgentId(httpRequest);
    if (!agentId) return;
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
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      // The per-caller list (conditional listing, dynamic descriptions) is
      // computed by ToolCatalogService so the console's catalogue endpoint
      // and this handler can never disagree (CLEAN-109).
      const listed = await this.catalog.listFor(httpRequest);

      // A pod lists once at boot: what it was told here is what it believes
      // it has. Hand the names to the recorder, if one is wired, so the
      // console can later tell a tool the pod has from one it lacks.
      this.recordListing(httpRequest, listed.map((t) => t.name));

      return {
        tools: listed.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

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

        try {
          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

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

          // A pod lists tools once at connect and caches them, so a caller
          // can hold a name that stopped applying to it since. Refuse here
          // rather than run it: for ask_agent that is the difference between
          // "you have no peers" and delegating through a removed connection.
          if (isConditionallyListed(toolInstance)) {
            const listedForCaller =
              await toolInstance.isListedForRequest(httpRequest);
            if (!listedForCaller) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Tool "${request.params.name}" is not available to this caller.`,
                  },
                ],
                isError: true,
              };
            }
          }

          const result = await toolInstance[toolInfo.methodName].call(
            toolInstance,
            request.params.arguments,
            context,
            httpRequest,
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
