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

      const tools = await Promise.all(
        this.registry.getTools().map(async (tool) => {
          let description = tool.metadata.description;
          // Tools may opt into per-caller descriptions by implementing
          // IDynamicallyDescribedTool. Failure to resolve or describe falls
          // back to the static decorator description so a broken tool can't
          // hide the rest of the list.
          try {
            const instance = await this.moduleRef.resolve(
              tool.providerClass,
              contextId,
              { strict: false },
            );
            if (isDynamicallyDescribed(instance)) {
              const dyn = await instance.describeForRequest(httpRequest);
              if (typeof dyn === 'string' && dyn.length > 0) {
                description = dyn;
              }
            }
          } catch (e) {
            this.logger.debug(
              `describeForRequest failed for ${tool.metadata.name}: ${
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
        tools,
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
