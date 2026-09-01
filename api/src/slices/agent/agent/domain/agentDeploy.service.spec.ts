import { AgentDeployService } from './agentDeploy.service';
import { WorkflowService } from '#/workflow/domain/workflow.service';
import { IAgentGateway } from './agent.gateway';
import { IAgentData } from './agent.types';
import { IFileGateway } from '#/agent/file/domain';

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

const agent = (over: Partial<IAgentData> = {}): IAgentData =>
  ({
    id: 'agent-new',
    templateId: 'tpl-1',
    workflowId: null,
    isAdmin: false,
    ...over,
  }) as IAgentData;

// Mocks live on a plain record (not behind the gateway abstract types) so
// expect(mocks.x) doesn't trip @typescript-eslint/unbound-method.
function build(over: { seedFromTemplate?: jest.Mock; findAdmin?: jest.Mock }) {
  const mocks = {
    create: jest.fn().mockResolvedValue(agent()),
    findById: jest.fn().mockResolvedValue(agent()),
    findAdmin: over.findAdmin ?? jest.fn().mockResolvedValue(null),
    setAdmin: jest.fn().mockResolvedValue(agent()),
    seedFromTemplate: over.seedFromTemplate ?? jest.fn().mockResolvedValue(3),
  };
  const agents = {
    create: mocks.create,
    findById: mocks.findById,
    findAdmin: mocks.findAdmin,
    setAdmin: mocks.setAdmin,
  } as unknown as IAgentGateway;
  const files = {
    seedFromTemplate: mocks.seedFromTemplate,
  } as unknown as IFileGateway;

  const service = new AgentDeployService(
    agents,
    {} as never, // templateGateway — unused by createAgent
    {} as never, // workflowService — reached only via mocked methods below
    {} as never, // authService
    files,
    {} as never, // skillGateway
    {} as never, // podGateway
    {} as never, // deployTracker
  );
  // createAgent orchestrates; the heavy submethods have their own flows.
  const deploy = jest
    .spyOn(service, 'deploy')
    .mockResolvedValue(undefined as never);
  const syncSkills = jest
    .spyOn(service, 'syncSkillsFromTemplate')
    .mockResolvedValue(undefined as never);
  const detach = jest
    .spyOn(service, 'detachAndCancelWorkflow')
    .mockResolvedValue(undefined as never);
  return { service, mocks, deploy, syncSkills, detach };
}

describe('AgentDeployService.createAgent', () => {
  it('creates, seeds template files, syncs skills, deploys — in order', async () => {
    const { service, mocks, deploy, syncSkills } = build({});
    const result = await service.createAgent({
      name: 'a',
      templateId: 'tpl-1',
    });

    expect(mocks.create).toHaveBeenCalledWith({
      name: 'a',
      templateId: 'tpl-1',
    });
    expect(mocks.seedFromTemplate).toHaveBeenCalledWith('agent-new', 'tpl-1');
    expect(syncSkills).toHaveBeenCalledWith('agent-new', 'tpl-1');
    expect(deploy).toHaveBeenCalledWith('agent-new');
    expect(result).toEqual(agent());
    // seed must precede deploy — the pod pulls S3 at boot.
    const seedOrder = mocks.seedFromTemplate.mock.invocationCallOrder[0];
    const deployOrder = deploy.mock.invocationCallOrder[0];
    expect(seedOrder).toBeLessThan(deployOrder);
  });

  it('survives a failing template seed (best-effort) and still deploys', async () => {
    const { service, deploy } = build({
      seedFromTemplate: jest.fn().mockRejectedValue(new Error('s3 down')),
    });
    await expect(
      service.createAgent({ name: 'a', templateId: 'tpl-1' }),
    ).resolves.toEqual(agent());
    expect(deploy).toHaveBeenCalledWith('agent-new');
  });

  it('does not touch admin flags when isAdmin is not requested', async () => {
    const { service, mocks } = build({});
    await service.createAgent({ name: 'a', templateId: 'tpl-1' });
    expect(mocks.findAdmin).not.toHaveBeenCalled();
    expect(mocks.setAdmin).not.toHaveBeenCalled();
  });

  it('promotes BEFORE the first deploy and demotes+redeploys the previous admin', async () => {
    const previous = agent({ id: 'agent-old', workflowId: 'wf-9' });
    const { service, mocks, deploy, detach } = build({
      findAdmin: jest.fn().mockResolvedValue(previous),
    });
    await service.createAgent(
      { name: 'a', templateId: 'tpl-1' },
      { isAdmin: true },
    );

    expect(mocks.setAdmin).toHaveBeenCalledWith('agent-old', false);
    expect(detach).toHaveBeenCalledWith('agent-old', 'wf-9');
    expect(deploy).toHaveBeenCalledWith('agent-old');
    expect(mocks.setAdmin).toHaveBeenCalledWith('agent-new', true);
    // Promote-before-deploy invariant: the new agent's first deploy must see
    // RANCH_ADMIN=true (no promote-then-redeploy race).
    const promoteOrder = mocks.setAdmin.mock.invocationCallOrder[1];
    const newDeployOrder = deploy.mock.invocationCallOrder.find(
      (_, i) => deploy.mock.calls[i][0] === 'agent-new',
    );
    expect(promoteOrder).toBeLessThan(newDeployOrder as number);
  });
});
