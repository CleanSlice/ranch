import { PaddockEvaluationTool } from './evaluation.tool';

const harness = () => {
  const service = {
    abort: jest.fn(async (id: string) => ({ id, status: 'aborted' })),
    rerun: jest.fn(async (id: string) => ({ id: `${id}-2`, status: 'running' })),
  };
  const tool = new PaddockEvaluationTool(service as never);
  return { tool, service };
};

const textOf = (r: { content: { text: string }[] }) => r.content[0].text;

describe('PaddockEvaluationTool — abort_paddock_evaluation (CLEAN-109)', () => {
  it('aborts once confirmed', async () => {
    const { tool, service } = harness();
    const result = await tool.abort({ id: 'ev-1', confirm: true });
    expect(service.abort).toHaveBeenCalledWith('ev-1');
    expect(textOf(result)).toContain('"status": "aborted"');
  });

  it('refuses without confirm and aborts nothing', async () => {
    const { tool, service } = harness();
    const result = await tool.abort({ id: 'ev-1' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('abort the paddock evaluation ev-1');
    expect(service.abort).not.toHaveBeenCalled();
  });

  it('rerun needs no confirmation', async () => {
    const { tool, service } = harness();
    const result = await tool.rerun({ id: 'ev-1' });
    expect(service.rerun).toHaveBeenCalledWith('ev-1');
    expect(result.isError).toBeUndefined();
  });
});
