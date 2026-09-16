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
import { zodToJsonSchema } from 'zod-to-json-schema';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';
import { isDynamicallyDescribed } from '../../interfaces/dynamic-description.interface';
import { isConditionallyListed } from '../../interfaces/conditional-listing.interface';

@Injectable({ scope: Scope.REQUEST })
export class McpToolsHandler extends McpHandlerBase {
  constructor(moduleRef: ModuleRef, registry: McpRegistryService) {
    super(moduleRef, registry, McpToolsHandler.name);
  }

  private convertZodToJsonSchema(parameters: any): any {
    try {
      return zodToJsonSchema(parameters);
    } catch {
      return undefined;
    }
  }

  registerHandlers(mcpServer: McpServer, httpRequest: Request) {
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const contextId = ContextIdFactory.getByRequest(httpRequest);
      this.moduleRef.registerRequestByContextId(httpRequest, contextId);

      const listed = await Promise.all(
        this.registry.getTools().map(async (tool) => {
          let description = tool.metadata.description;
          // Tools may opt into per-caller descriptions by implementing
          // IDynamicallyDescribedTool, and out of the list entirely by
          // implementing IConditionallyListedTool. Failure to resolve,
          // describe or decide falls back to listing the tool with its
          // static decorator description, so a broken tool can't hide
          // itself or the rest of the list.
          try {
            const instance = await this.moduleRef.resolve(
              tool.providerClass,
              contextId,
              { strict: false },
            );
            if (isConditionallyListed(instance)) {
              const listedForCaller =
                await instance.isListedForRequest(httpRequest);
              if (!listedForCaller) return null;
            }
            if (isDynamicallyDescribed(instance)) {
              const dyn = await instance.describeForRequest(httpRequest);
              if (typeof dyn === 'string' && dyn.length > 0) {
                description = dyn;
              }
            }
          } catch (e) {
            this.logger.debug(
              `tools/list hooks failed for ${tool.metadata.name}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          }
          return {
            name: tool.metadata.name,
            description,
            inputSchema: tool.metadata.parameters
              ? this.convertZodToJsonSchema(tool.metadata.parameters)
              : undefined,
          };
        }),
      );

      return {
        tools: listed.filter((tool) => tool !== null),
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
