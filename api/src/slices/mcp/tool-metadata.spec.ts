/**
 * The boot check, without a database (CLEAN-109, FR-005): load every
 * `*.tool.ts` under src/slices, read the @Tool metadata off each method the
 * way McpRegistryService does, and run the same validation the API runs at
 * bootstrap. A tool that would refuse to boot fails here first.
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MCP_TOOL_METADATA_KEY, type ToolMetadata } from './decorators';
import { toolMetadataProblems } from './services/mcp-registry.service';
import { TOOL_TOPIC_KEYS } from './decorators/topics';

jest.mock('@kubernetes/client-node', () => ({
  KubeConfig: class {
    loadFromDefault() {}
    loadFromCluster() {}
    makeApiClient() {
      return {};
    }
  },
  CoreV1Api: class {},
  CustomObjectsApi: class {},
  Log: class {},
  Watch: class {},
}));

const SLICES = join(__dirname, '..');

function toolFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      out.push(...toolFiles(full));
    } else if (entry.endsWith('.tool.ts')) {
      out.push(full);
    }
  }
  return out.sort();
}

interface Discovered {
  file: string;
  className: string;
  method: string;
  metadata: ToolMetadata;
}

const loadErrors: string[] = [];

function discover(): Discovered[] {
  const found: Discovered[] = [];
  for (const file of toolFiles(SLICES)) {
    let mod: Record<string, unknown>;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      mod = require(file) as Record<string, unknown>;
    } catch (e) {
      loadErrors.push(
        `${relative(SLICES, file)}: ${(e as Error).stack ?? String(e)}`,
      );
      continue;
    }
    for (const [className, exported] of Object.entries(mod)) {
      if (typeof exported !== 'function' || !exported.prototype) continue;
      const proto = exported.prototype as Record<string, unknown>;
      for (const method of Object.getOwnPropertyNames(proto)) {
        if (method === 'constructor') continue;
        // Descriptors, not property reads: a getter on the prototype (LlmTool
        // resolves a gateway lazily that way) must not run without `this`.
        const descriptor = Object.getOwnPropertyDescriptor(proto, method);
        const ref = descriptor?.value as unknown;
        if (typeof ref !== 'function') continue;
        const metadata = Reflect.getMetadata(MCP_TOOL_METADATA_KEY, ref) as
          | ToolMetadata
          | undefined;
        if (metadata) {
          found.push({
            file: relative(SLICES, file),
            className,
            method,
            metadata,
          });
        }
      }
    }
  }
  return found;
}

describe('every @Tool in the API satisfies the boot-time contract', () => {
  const tools = discover();

  it('loads every tool file', () => {
    expect(loadErrors).toEqual([]);
  });

  it('finds the tool set (sanity: the audit expects well over a hundred)', () => {
    expect(tools.length).toBeGreaterThan(100);
  });

  it('has no duplicate tool names', () => {
    const names = tools.map((t) => t.metadata.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('every tool has a valid topic, title, template and confirm on destructive tools', () => {
    const problems = tools.flatMap((t) =>
      toolMetadataProblems(t.metadata).map(
        (p) => `${t.file} ${t.className}.${t.method}: ${p}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('every topic in use is a known topic', () => {
    const unknown = tools
      .filter((t) => !(TOOL_TOPIC_KEYS as string[]).includes(t.metadata.topic))
      .map((t) => `${t.metadata.name}: ${String(t.metadata.topic)}`);
    expect(unknown).toEqual([]);
  });

  it('destructive tools end their description with the confirmation sentence', () => {
    const missing = tools
      .filter((t) => t.metadata.destructive)
      .filter((t) => !/confirm: true/.test(t.metadata.description))
      .map((t) => t.metadata.name);
    expect(missing).toEqual([]);
  });
});
