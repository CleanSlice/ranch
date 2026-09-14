import { AgentMcpResolver } from './agentMcpResolver.service';
import {
  CLEANSLICE_MCP_ID,
  DOCUMENTS_MCP_ID,
  KNOWLEDGE_MCP_ID,
} from './mcpServer.seeder';
import type { IMcpServerData } from './mcpServer.types';

/**
 * Which MCP servers an agent gets used to be decided twice, by two copies of
 * this logic that disagreed: the runtime-facing endpoint injected Documents
 * and forgot CleanSlice, while the path that actually writes MCP_SERVERS_B64
 * injected CleanSlice and forgot Documents. Production showed exactly that —
 * the pod booted with CleanSlice alone while the endpoint answered Documents
 * alone, so query_attachment never reached an agent (CLEAN-87).
 *
 * These pin the canonical set. Both call sites now run this one function, so
 * a future gap can only be a gap in both at once.
 */
function server(id: string, enabled = true): IMcpServerData {
  return { id, name: id, url: `http://${id}`, enabled } as IMcpServerData;
}

function build(opts: {
  templateServerIds?: string[];
  templateDefaultKnowledgeIds?: string[];
  rows?: IMcpServerData[];
  knowledgeEnabled?: boolean;
  existingKnowledge?: string[];
  template?: unknown;
}) {
  const rows = new Map(
    (
      opts.rows ?? [
        server(CLEANSLICE_MCP_ID),
        server(DOCUMENTS_MCP_ID),
        server(KNOWLEDGE_MCP_ID),
      ]
    ).map((r) => [r.id, r]),
  );

  const templateGateway = {
    findById: () =>
      Promise.resolve(
        opts.template === null
          ? null
          : {
              mcpServerIds: opts.templateServerIds ?? [],
              defaultKnowledgeIds: opts.templateDefaultKnowledgeIds ?? [],
            },
      ),
  };
  const mcpServerGateway = {
    findById: (id: string) => Promise.resolve(rows.get(id) ?? null),
    findByIds: (ids: string[]) =>
      Promise.resolve(ids.map((i) => rows.get(i)).filter(Boolean)),
  };
  const knowledgeGateway = {
    findExistingByIds: (ids: string[]) =>
      Promise.resolve(
        (opts.existingKnowledge ?? ids).map((id) => ({ id })) as never,
      ),
  };
  const knowledgeConfig = {
    isEnabled: () => Promise.resolve(opts.knowledgeEnabled ?? false),
  };

  return new AgentMcpResolver(
    templateGateway as never,
    mcpServerGateway as never,
    knowledgeGateway as never,
    knowledgeConfig as never,
  );
}

const idsOf = (rows: IMcpServerData[]) => rows.map((r) => r.id).sort();

describe('AgentMcpResolver', () => {
  it('gives every agent both always-on built-ins', async () => {
    // The whole point of CLEAN-87: neither list may be missing one of these.
    const resolver = build({});
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: [],
    });

    expect(idsOf(out)).toEqual([CLEANSLICE_MCP_ID, DOCUMENTS_MCP_ID].sort());
  });

  it('keeps the template’s own enabled servers', async () => {
    const resolver = build({
      templateServerIds: ['mcp-silpo'],
      rows: [
        server('mcp-silpo'),
        server(CLEANSLICE_MCP_ID),
        server(DOCUMENTS_MCP_ID),
      ],
    });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: [],
    });

    expect(idsOf(out)).toContain('mcp-silpo');
  });

  it('drops a template server an operator disabled', async () => {
    const resolver = build({
      templateServerIds: ['mcp-silpo'],
      rows: [
        server('mcp-silpo', false),
        server(CLEANSLICE_MCP_ID),
        server(DOCUMENTS_MCP_ID),
      ],
    });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: [],
    });

    expect(idsOf(out)).not.toContain('mcp-silpo');
  });

  it('omits a built-in that is disabled globally', async () => {
    const resolver = build({
      rows: [server(CLEANSLICE_MCP_ID), server(DOCUMENTS_MCP_ID, false)],
    });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: [],
    });

    expect(idsOf(out)).toEqual([CLEANSLICE_MCP_ID]);
  });

  it('never lists a built-in twice when the template already attaches it', async () => {
    const resolver = build({ templateServerIds: [DOCUMENTS_MCP_ID] });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: [],
    });

    expect(out.filter((r) => r.id === DOCUMENTS_MCP_ID)).toHaveLength(1);
  });

  it('adds Knowledge when the agent has a base and the feature is on', async () => {
    const resolver = build({ knowledgeEnabled: true });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: ['kb1'],
    });

    expect(idsOf(out)).toContain(KNOWLEDGE_MCP_ID);
  });

  it('withholds Knowledge when the feature is off', async () => {
    const resolver = build({ knowledgeEnabled: false });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: ['kb1'],
    });

    expect(idsOf(out)).not.toContain(KNOWLEDGE_MCP_ID);
  });

  it('withholds Knowledge when the referenced base does not exist', async () => {
    const resolver = build({ knowledgeEnabled: true, existingKnowledge: [] });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: ['gone'],
    });

    expect(idsOf(out)).not.toContain(KNOWLEDGE_MCP_ID);
  });

  it('falls back to the template’s default bases when the agent has none', async () => {
    const resolver = build({
      knowledgeEnabled: true,
      templateDefaultKnowledgeIds: ['kb-default'],
    });
    const out = await resolver.resolveForAgent({
      templateId: 't1',
      knowledgeIds: [],
    });

    expect(idsOf(out)).toContain(KNOWLEDGE_MCP_ID);
  });

  it('still returns the always-on built-ins when the template is gone', async () => {
    // A missing template used to return [] on the endpoint path, which would
    // silently strip an agent of every tool.
    const resolver = build({ template: null });
    const out = await resolver.resolveForAgent({
      templateId: 'missing',
      knowledgeIds: [],
    });

    expect(idsOf(out)).toEqual([CLEANSLICE_MCP_ID, DOCUMENTS_MCP_ID].sort());
  });
});
