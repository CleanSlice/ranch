import { PaddockScenarioTool } from './scenario.tool';

const draft = (name: string) => ({
  templateId: null,
  agentId: 'agent-1',
  category: 'conversation',
  difficulty: 'medium',
  name,
  description: `${name} desc`,
  expectedBehavior: 'Refunds within policy',
  messages: [{ text: 'I want a refund', from: 'user' }],
  successCriteria: [
    { dimension: 'correctness', description: 'Quotes policy', weight: 1 },
  ],
  setup: null,
});

const harness = () => {
  const scenarios = {
    findAll: jest.fn(async () => []),
    findById: jest.fn(async (id: string) =>
      id === 'sc-1' ? { id: 'sc-1', name: 'Refund flow' } : null,
    ),
    delete: jest.fn(async () => undefined),
    create: jest.fn(),
    update: jest.fn(),
  };
  let n = 0;
  const generator = {
    generate: jest.fn(async () => draft(`Draft ${++n}`)),
  };
  const tool = new PaddockScenarioTool(scenarios as never, generator as never);
  return { tool, scenarios, generator };
};

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe('PaddockScenarioTool — delete_paddock_scenario (CLEAN-109)', () => {
  it('deletes once confirmed', async () => {
    const { tool, scenarios } = harness();
    const result = await tool.remove({ id: 'sc-1', confirm: true });
    expect(scenarios.delete).toHaveBeenCalledWith('sc-1');
    expect(textOf(result)).toContain('"ok": true');
  });

  it('refuses without confirm, naming the scenario, and deletes nothing', async () => {
    const { tool, scenarios } = harness();
    const result = await tool.remove({ id: 'sc-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('«Refund flow»');
    expect(textOf(result)).toContain('confirm: true');
    expect(scenarios.delete).not.toHaveBeenCalled();
  });

  it('reports a missing scenario before asking for confirmation', async () => {
    const { tool, scenarios } = harness();
    const result = await tool.remove({ id: 'nope' });
    expect(textOf(result)).toContain('not found');
    expect(scenarios.delete).not.toHaveBeenCalled();
  });
});

describe('PaddockScenarioTool — generate_paddock_scenarios (CLEAN-109)', () => {
  it('drafts one scenario by default, passing the scope through as the controller does', async () => {
    const { tool, generator, scenarios } = harness();
    const result = await tool.generate({
      description: 'refund requests',
      agentId: 'agent-1',
      category: 'conversation',
    });
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(generator.generate).toHaveBeenCalledWith({
      description: 'refund requests',
      templateId: undefined,
      agentId: 'agent-1',
      category: 'conversation',
      difficulty: undefined,
      credentialId: undefined,
    });
    const text = textOf(result);
    expect(text).toContain('"name": "Draft 1"');
    expect(text).toContain('Not saved');
    // Drafts are for review; the tool never persists them.
    expect(scenarios.create).not.toHaveBeenCalled();
  });

  it('drafts «count» scenarios one after another', async () => {
    const { tool, generator } = harness();
    const result = await tool.generate({
      description: 'refund requests',
      templateId: 'tpl-1',
      count: 3,
      credentialId: 'cred-1',
    });
    expect(generator.generate).toHaveBeenCalledTimes(3);
    expect(generator.generate).toHaveBeenLastCalledWith(
      expect.objectContaining({ templateId: 'tpl-1', credentialId: 'cred-1' }),
    );
    const text = textOf(result);
    expect(text).toContain('"name": "Draft 1"');
    expect(text).toContain('"name": "Draft 3"');
  });

  it('refuses an ambiguous scope without calling the LLM', async () => {
    const { tool, generator } = harness();
    const both = await tool.generate({
      description: 'x',
      agentId: 'agent-1',
      templateId: 'tpl-1',
    });
    const neither = await tool.generate({ description: 'x' });
    expect(textOf(both)).toContain('exactly one of');
    expect(textOf(neither)).toContain('exactly one of');
    expect(generator.generate).not.toHaveBeenCalled();
  });
});
