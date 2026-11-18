import type { Request } from 'express';
import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { IAgentData } from '#/agent/agent/domain/agent.types';
import { AgentPermissionService } from '#/agent/agent/domain/agentPermission.service';
import { READER_HIDDEN_FIELDS } from '#/agent/agent/domain/agentReaderView';
import type { IAuthTokenPayload } from '#/user/auth/domain/auth.types';
import {
  ADMIN,
  ADMIN2,
  OWNER,
  accessHarness,
} from '#/user/agentAccess/domain/__fixtures__/agentAccess';
import { UserRoleTypes } from '#/user/user/domain';
import type { RancherService } from './domain/rancher.service';
import { rancherStatusFor } from './domain/rancherStatusView';
import { RancherController } from './rancher.controller';

/**
 * `GET /rancher/status` names the Ranch admin agent by its flag, not by an
 * id, so no route marker covers it (CLEAN-231). It used to hand the whole
 * row to any Admin, also to one for whom `GET /agents/admin/current` and
 * `GET /agents/<its id>` answer 404. What each caller gets now.
 */

const RANCH = 'agent-ranch';
const OPERATOR_NOTE = 'operator-only-note';

const ranchAgent = (): IAgentData =>
  ({
    id: RANCH,
    name: 'Rancher',
    templateId: 'template-rancher',
    llmCredentialId: 'llm-1',
    status: 'running',
    statusReason: 'boot warning',
    workflowId: 'wf-1',
    firstDeployedAt: new Date(0),
    lastDeployStartedAt: new Date(0),
    launchContext: 'initial',
    lastPullAt: new Date(0),
    lastSyncAt: new Date(0),
    config: { note: OPERATOR_NOTE },
    resources: { cpu: '1', memory: '1Gi' },
    debugEnabled: true,
    isPublic: false,
    allowedOrigins: [],
    knowledgeIds: ['kb-1'],
    isAdmin: true,
    pinned: false,
    createdById: OWNER.id,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as IAgentData;

const TEMPLATE = { id: 'template-rancher', name: 'Rancher' };

function harness(admin: IAgentData | null = ranchAgent()) {
  const { service: access, gateway: lists } = accessHarness([RANCH, 'agent-a']);
  const agents = {
    findById: (id: string) => Promise.resolve(admin?.id === id ? admin : null),
    hasCreatedBy: () => Promise.resolve(false),
  } as unknown as IAgentGateway;
  const rancher = {
    getStatus: () =>
      Promise.resolve({ hasLlm: true, hasS3: false, template: TEMPLATE, admin }),
  } as unknown as RancherService;
  const controller = new RancherController(
    rancher,
    access,
    new AgentPermissionService(agents, access),
  );
  const as = (p: { id: string; role: UserRoleTypes }) =>
    controller.status({
      user: { sub: p.id, email: '', roles: [p.role] },
    } as Request & { user?: IAuthTokenPayload });
  return { lists, as };
}

describe('GET /rancher/status', () => {
  it('the Owner gets the Ranch admin agent whole, without the bare creator id', async () => {
    const { as } = harness();
    const status = await as(OWNER);
    expect(status).toMatchObject({
      hasLlm: true,
      hasS3: false,
      template: TEMPLATE,
      hasAdmin: true,
    });
    expect(status.admin).toMatchObject({
      id: RANCH,
      name: 'Rancher',
      llmCredentialId: 'llm-1',
      config: { note: OPERATOR_NOTE },
      isAdmin: true,
    });
    expect(status.admin).not.toHaveProperty('createdById');
  });

  it('an Admin who reaches it gets its reader view: what the page draws, nothing of the operator’s', async () => {
    const { as } = harness();
    const status = await as(ADMIN);
    // The page needs the id (to open the chat), the name and the status.
    expect(status.admin).toMatchObject({
      id: RANCH,
      name: 'Rancher',
      status: 'running',
      isAdmin: true,
    });
    expect(status.hasAdmin).toBe(true);
    const admin = status.admin as unknown as Record<string, unknown>;
    expect(admin.config).toEqual({});
    expect(admin.knowledgeIds).toEqual([]);
    expect(admin.debugEnabled).toBe(false);
    for (const field of READER_HIDDEN_FIELDS) {
      if (['config', 'knowledgeIds', 'debugEnabled'].includes(field)) continue;
      expect([field, admin[field]]).toEqual([field, null]);
    }
    expect(JSON.stringify(status)).not.toContain(OPERATOR_NOTE);
    expect(JSON.stringify(status)).not.toContain('llm-1');
    expect(status.admin).not.toHaveProperty('createdById');
  });

  it('an Admin whose lists do not reach it gets nothing that identifies it', async () => {
    const { as, lists } = harness();
    // Limited to another agent: the case the consoles e2e found.
    lists.seed(ADMIN.id, true, [{ agentId: 'agent-a', list: 'allowed' }]);
    // And an open account with the agent denied.
    lists.seed(ADMIN2.id, false, [{ agentId: RANCH, list: 'denied' }]);

    for (const who of [ADMIN, ADMIN2]) {
      const status = await as(who);
      expect(status.admin).toBeNull();
      const text = JSON.stringify(status);
      expect(text).not.toContain(RANCH);
      expect(text).not.toContain(OPERATOR_NOTE);
      expect(text).not.toContain('llm-1');
      // The setup state itself is still told: the stepper needs it.
      expect(status).toMatchObject({
        hasLlm: true,
        hasS3: false,
        template: TEMPLATE,
        hasAdmin: true,
      });
    }
  });

  it('says so when there is no Ranch admin agent yet', async () => {
    const { as } = harness(null);
    expect(await as(OWNER)).toMatchObject({ hasAdmin: false, admin: null });
    expect(await as(ADMIN)).toMatchObject({ hasAdmin: false, admin: null });
  });

  it('an agent runtime’s token is nobody here, whatever roles it carries', async () => {
    const { as } = harness();
    // The role guard refuses it before the handler; if it ever got here it
    // would be read as a caller who may not manage the agent.
    const status = await as({
      id: 'agent:agent-ranch',
      role: UserRoleTypes.Owner,
    });
    expect(JSON.stringify(status)).not.toContain(OPERATOR_NOTE);
  });
});

describe('rancherStatusFor', () => {
  const status = {
    hasLlm: true,
    hasS3: true,
    template: null,
    admin: ranchAgent(),
  };

  it('never hands the row to a caller who does not reach it, managing or not', () => {
    for (const manages of [true, false]) {
      const view = rancherStatusFor(status, { reaches: false, manages });
      expect(view.admin).toBeNull();
      expect(view.hasAdmin).toBe(true);
    }
  });

  it('leaves the stored row as it was', () => {
    rancherStatusFor(status, { reaches: true, manages: false });
    expect(status.admin.config).toEqual({ note: OPERATOR_NOTE });
    expect(status.admin.createdById).toBe(OWNER.id);
  });
});
