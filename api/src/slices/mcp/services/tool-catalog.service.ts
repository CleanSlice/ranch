import { Injectable, Logger } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import type { Request } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { McpRegistryService } from './mcp-registry.service';
import { isDynamicallyDescribed } from '../interfaces/dynamic-description.interface';
import { isConditionallyListed } from '../interfaces/conditional-listing.interface';
import { CallerToolPolicy } from '../interfaces/caller-tool-policy.interface';
import type { ToolMetadata } from '../decorators';

/** One tool as a given caller sees it: the per-caller description applied. */
export interface IListedTool {
  name: string;
  description: string;
  inputSchema: unknown;
  metadata: ToolMetadata;
}

/**
 * "Which tools does this caller see, described how?" — the single answer for
 * MCP tools/list (a real request from a pod) and for the console's catalogue
 * (a synthetic request carrying the principal a pod would have). One
 * implementation, so the panel can never disagree with the runtime
 * (CLEAN-109, research R3).
 */
@Injectable()
export class ToolCatalogService {
  private readonly logger = new Logger(ToolCatalogService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly registry: McpRegistryService,
  ) {}

  async listFor(httpRequest: Request): Promise<IListedTool[]> {
    const contextId = ContextIdFactory.getByRequest(httpRequest);
    this.moduleRef.registerRequestByContextId(httpRequest, contextId);

    const allowed = await this.allowedNamesFor(httpRequest);
    const listed = await Promise.all(
      this.registry
        .getTools()
        .map(async (tool): Promise<IListedTool | null> => {
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
            metadata: tool.metadata,
          };
        }),
    );

    return listed.filter(
      (tool): tool is IListedTool =>
        tool !== null && (allowed === null || allowed.has(tool.name)),
    );
  }

  /**
   * The names the caller's template allows, or null for every tool
   * (CLEAN-209). No policy registered, or one that throws, allows everything:
   * a broken check must not empty an agent's tool list. The handler asks the
   * same question on tools/call, so a cached name past the list is refused.
   */
  async allowedNamesFor(httpRequest: Request): Promise<Set<string> | null> {
    try {
      const policy = this.moduleRef.get(CallerToolPolicy, { strict: false });
      return policy ? await policy.allowedToolsFor(httpRequest) : null;
    } catch (e) {
      this.logger.debug(
        `caller tool policy unavailable: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private convertZodToJsonSchema(parameters: any): unknown {
    try {
      return zodToJsonSchema(parameters);
    } catch {
      return undefined;
    }
  }
}
