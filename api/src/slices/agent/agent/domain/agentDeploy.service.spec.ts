import { AgentDeployService } from './agentDeploy.service';
import { IAgentGateway } from './agent.gateway';
import { IAgentData } from './agent.types';
import { IFileGateway } from '#/agent/file/domain';

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
