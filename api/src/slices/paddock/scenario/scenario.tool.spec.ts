import { PaddockScenarioTool } from './scenario.tool';

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
  const tool = new PaddockScenarioTool(scenarios as never);
  return { tool, scenarios };
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
