import { AgentDeployService } from './agentDeploy.service';
import { WorkflowService } from '#/workflow/domain/workflow.service';

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    name: 'Test agent',
    templateId: 't1',
    status: 'stopped',
    statusReason: null,
    workflowId: null,
    firstDeployedAt: new Date(),
    isAdmin: false,
    ...overrides,
  };
}

function createDeployBed(bridleWarning: string | null) {
  const agentGateway = {
    findById: jest.fn().mockResolvedValue(makeAgent()),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    markDeployStarted: jest.fn().mockResolvedValue(undefined),
    setWorkflowId: jest.fn().mockResolvedValue(undefined),
    setFirstDeployedAt: jest.fn().mockResolvedValue(undefined),
    setStatusReason: jest.fn().mockResolvedValue(undefined),
  };
  const workflowService = {
    submitAgentWorkflow: jest.fn().mockResolvedValue('wf-new'),
    checkBridleSettings: jest.fn().mockResolvedValue(bridleWarning),
    cancelAgentWorkflow: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AgentDeployService(
    agentGateway as never,
    { findById: jest.fn().mockResolvedValue({ id: 't1', image: 'img', skillIds: [] }) } as never,
    workflowService as never,
    { issueAgentServiceToken: jest.fn().mockResolvedValue('tok') } as never,
    { resyncFromTemplate: jest.fn(), syncSkills: jest.fn() } as never,
    { findByIds: jest.fn().mockResolvedValue([]) } as never,
    { delete: jest.fn() } as never,
    { mark: jest.fn(), clear: jest.fn(), isStale: jest.fn() } as never,
  );
  return { service, agentGateway, workflowService };
}

describe('AgentDeployService bridle settings warning', () => {
  afterEach(() => jest.clearAllMocks());

  test('empty bridle setting → warn reason written, deploy still proceeds', async () => {
    const warning =
      'integrations/bridle_api_key is not set — the agent pod will start without hub credentials and can never come online; set it at /settings/bridle and restart the agent';
    const bed = createDeployBed(warning);

    await bed.service.deploy('a1');

    expect(bed.agentGateway.setStatusReason).toHaveBeenCalledWith(
      'a1',
      warning,
    );
    // Non-blocking: the workflow submit must still happen.
    expect(bed.workflowService.submitAgentWorkflow).toHaveBeenCalledTimes(1);
    expect(bed.agentGateway.setWorkflowId).toHaveBeenCalledWith('a1', 'wf-new');
  });

  test('both settings present → no reason written', async () => {
    const bed = createDeployBed(null);

    await bed.service.deploy('a1');

    expect(bed.agentGateway.setStatusReason).not.toHaveBeenCalled();
    expect(bed.workflowService.submitAgentWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowService.checkBridleSettings', () => {
  function createWorkflowService(values: Record<string, string | undefined>) {
    const settingGateway = {
      findByKey: jest
        .fn()
        .mockImplementation((group: string, name: string) =>
          Promise.resolve(
            values[name] === undefined ? null : { value: values[name] },
          ),
        ),
    };
    const service = new WorkflowService(
      { submit: jest.fn(), previewEnv: jest.fn(), cancel: jest.fn() } as never,
      settingGateway as never,
    );
    return { service, settingGateway };
  }

  test('returns a warning naming the first empty key', async () => {
    const { service } = createWorkflowService({
      bridle_url: 'http://hub/ws/agent',
      bridle_api_key: '',
    });
    const warning = await service.checkBridleSettings();
    expect(warning).toContain('integrations/bridle_api_key');
    expect(warning).toContain('/settings/bridle');
    expect(warning).toContain('restart the agent');
  });

  test('returns a warning when the setting row is missing entirely', async () => {
    const { service } = createWorkflowService({
      bridle_api_key: 'secret',
    });
    const warning = await service.checkBridleSettings();
    expect(warning).toContain('integrations/bridle_url');
  });

  test('returns null when both settings are set in the DB', async () => {
    const { service } = createWorkflowService({
      bridle_url: 'http://hub/ws/agent',
      bridle_api_key: 'secret',
    });
    await expect(service.checkBridleSettings()).resolves.toBeNull();
  });
});
