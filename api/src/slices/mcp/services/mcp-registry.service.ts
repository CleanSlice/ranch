import {
  Injectable,
  InjectionToken,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  MCP_PROMPT_METADATA_KEY,
  MCP_RESOURCE_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
  ToolMetadata,
  isToolTopic,
} from '../decorators';
import { ResourceMetadata } from '../decorators/resource.decorator';
import { match } from 'path-to-regexp';
import { PromptMetadata } from '../decorators/prompt.decorator';
import { Logger } from '@nestjs/common';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const TOOL_TITLE_MAX = 60;
export const TOOL_TEMPLATE_MAX = 200;

/**
 * The panel contract every tool must satisfy (CLEAN-109). Returns the
 * problems found, empty when the metadata is complete. Exported so a spec
 * can exercise it without booting a module.
 */
export function toolMetadataProblems(metadata: Partial<ToolMetadata>): string[] {
  const problems: string[] = [];
  const name = metadata.name ?? '<unnamed>';
  if (!metadata.name) problems.push('missing name');
  if (!isToolTopic(metadata.topic)) {
    problems.push(`unknown topic "${String(metadata.topic)}"`);
  }
  const title = (metadata.title ?? '').trim();
  if (!title) problems.push('missing title');
  else if (title.length > TOOL_TITLE_MAX) {
    problems.push(`title longer than ${TOOL_TITLE_MAX} chars`);
  }
  const template = (metadata.template ?? '').trim();
  if (!template) problems.push('missing template');
  else if (template.length > TOOL_TEMPLATE_MAX) {
    problems.push(`template longer than ${TOOL_TEMPLATE_MAX} chars`);
  }

  let properties: Record<string, unknown> = {};
  let required: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params = metadata.parameters as any;
    const schema = (params ? zodToJsonSchema(params) : {}) as unknown as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    properties = schema.properties ?? {};
    required = schema.required ?? [];
  } catch {
    problems.push('parameters cannot be converted to JSON schema');
  }
  // A template needs a «…» only when the person must supply something: a
  // required parameter other than `confirm` (which the model sets, not the
  // person). Optional filters ("List the knowledge bases") need none.
  const needsPlaceholder = required.some((k) => k !== 'confirm');
  if (template && needsPlaceholder && !template.includes('«')) {
    problems.push('template has parameters but no «…» placeholder');
  }
  if (metadata.destructive) {
    const confirm = properties.confirm as { type?: unknown } | undefined;
    if (!confirm || confirm.type !== 'boolean') {
      problems.push('destructive tool without a boolean `confirm` parameter');
    }
  }
  return problems.map((p) => `${name}: ${p}`);
}

/**
 * Interface representing a discovered tool
 */
export type DiscoveredTool<T extends object> = {
  type: 'tool' | 'resource' | 'prompt';
  metadata: T;
  providerClass: InjectionToken;
  methodName: string;
};

/**
 * Singleton service that discovers and registers tools during application bootstrap
 */
@Injectable()
export class McpRegistryService implements OnApplicationBootstrap {
  private discoveredTools: DiscoveredTool<any>[] = [];
  private readonly logger = new Logger(McpRegistryService.name);

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  onApplicationBootstrap() {
    this.discoverTools();
    this.validateToolMetadata();
  }

  /**
   * A tool the Tools panel cannot show is a tool the person never finds, so
   * the API refuses to start with one (CLEAN-109, FR-005). Names must also be
   * unique: `findTool` would silently serve the first of two.
   */
  validateToolMetadata(): void {
    const tools = this.getTools();
    const problems = tools.flatMap((t) => toolMetadataProblems(t.metadata));
    const seen = new Set<string>();
    for (const t of tools) {
      const name = t.metadata?.name;
      if (!name) continue;
      if (seen.has(name)) problems.push(`${name}: duplicate tool name`);
      seen.add(name);
    }
    if (problems.length) {
      throw new Error(
        `MCP tool metadata is incomplete — every @Tool needs topic, title and template, and a destructive tool needs a boolean confirm parameter:\n  - ${problems.join('\n  - ')}`,
      );
    }
    this.logger.log(`Validated ${tools.length} MCP tools`);
  }

  /**
   * Scans all providers and controllers for @Tool decorators
   */
  private discoverTools() {
    const providers = this.discovery.getProviders();
    const controllers = this.discovery.getControllers();
    const allInstances = [...providers, ...controllers]
      .filter(
        (wrapper) =>
          wrapper.instance &&
          typeof wrapper.instance === 'object' &&
          wrapper.instance !== null,
      )
      .map((wrapper) => ({
        instance: wrapper.instance as object,
        token: wrapper.token,
      }));

    allInstances.forEach(({ instance, token }) => {
      this.metadataScanner.getAllMethodNames(instance).forEach((methodName) => {
        const methodRef = instance[methodName] as object;
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        if (methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          this.addDiscoveryTool(methodRef, token, methodName);
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_METADATA_KEY)) {
          this.addDiscoveryResource(methodRef, token, methodName);
        }

        if (methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY)) {
          this.addDiscoveryPrompt(methodRef, token, methodName);
        }
      });
    });
  }

  /**
   * Adds a discovered tool to the registry
   */
  private addDiscovery<T>(
    type: 'tool' | 'resource' | 'prompt',
    metadataKey: string,
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    const metadata: T = Reflect.getMetadata(metadataKey, methodRef);

    this.discoveredTools.push({
      type,
      metadata,
      providerClass: token,
      methodName,
    });
  }

  private addDiscoveryPrompt(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<PromptMetadata>(
      'prompt',
      MCP_PROMPT_METADATA_KEY,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryTool(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<ToolMetadata>(
      'tool',
      MCP_TOOL_METADATA_KEY,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryResource(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<ResourceMetadata>(
      'resource',
      MCP_RESOURCE_METADATA_KEY,
      methodRef,
      token,
      methodName,
    );
  }

  /**
   * Get all discovered tools
   */
  getTools(): DiscoveredTool<ToolMetadata>[] {
    const tools = this.discoveredTools.filter((tool) => tool.type === 'tool');
    return tools;
  }

  /**
   * Find a tool by name
   */
  findTool(name: string): DiscoveredTool<ToolMetadata> | undefined {
    const tool = this.getTools().find((tool) => tool.metadata.name === name);
    return tool;
  }

  /**
   * Get all discovered resources
   */
  getResources(): DiscoveredTool<ResourceMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'resource');
  }

  /**
   * Find a resource by name
   */
  findResource(name: string): DiscoveredTool<ResourceMetadata> | undefined {
    return this.getResources().find((tool) => tool.metadata.name === name);
  }

  /**
   * Get all discovered prompts
   */
  getPrompts(): DiscoveredTool<PromptMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'prompt');
  }

  /**
   * Find a prompt by name
   */
  findPrompt(name: string): DiscoveredTool<PromptMetadata> | undefined {
    return this.getPrompts().find((tool) => tool.metadata.name === name);
  }

  private convertTemplate(template: string): string {
    if (!template || typeof template !== 'string') {
      return '';
    }
    return template.replace(/{(\w+)}/g, ':$1');
  }

  private convertUri(uri: string): string {
    if (uri.includes('://')) {
      return uri.split('://')[1];
    }

    return uri;
  }

  /**
   * Find a resource by uri
   * @returns An object containing the found resource and extracted parameters, or undefined if no resource is found
   */
  findResourceByUri(uri: string):
    | {
        resource: DiscoveredTool<ResourceMetadata>;
        params: Record<string, string>;
      }
    | undefined {
    const resources = this.getResources().map((tool) => ({
      name: tool.metadata.name,
      uri: tool.metadata.uri,
    }));

    const strippedInputUri = this.convertUri(uri);

    for (const t of resources) {
      if (!t.uri) continue;

      const rawTemplate = t.uri;
      const templatePath = this.convertTemplate(this.convertUri(rawTemplate));
      // path-to-regexp v8 requires `delimiter` to be a string (was previously
      // passed `decodeURIComponent` as a function via `as any`, which crashes
      // with "str.replace is not a function" inside the lib). Default `/`
      // works fine for URI paths.
      const matcher = match(templatePath);
      const result = matcher(strippedInputUri);

      if (result) {
        const foundResource = this.findResource(t.name);
        if (!foundResource) continue;

        return {
          resource: foundResource,
          params: result.params as Record<string, string>,
        };
      }
    }

    return undefined;
  }
}
