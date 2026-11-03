import type { Request } from 'express';
import { TemplateToolPolicyService } from './templateToolPolicy.service';
import type { ITemplateGateway } from './template.gateway';
import type { IAgentGateway } from '#/agent/agent/domain';

// The template's tool allowlist per caller (CLEAN-209): agents of a template
// with a list get that list; everyone else, and every template without a
// list, gets every tool.

const agentReq = (id: string) =>
  ({ user: { sub: `agent:${id}`, roles: ['agent'] } }) as unknown as Request;
const personReq = () =>
  ({ user: { sub: 'user-1', roles: ['owner'] } }) as unknown as Request;

function build(opts: {
  templateId?: string | null;
  toolAllowlist?: string[] | null;
  template?: boolean;
}) {
  const agents = {
    findById: jest.fn(async (id: string) => ({
      id,
      templateId: opts.templateId === undefined ? 'tpl-1' : opts.templateId,
    })),
  };
  const templates = {
    findById: jest.fn(async (id: string) =>
      opts.template === false
        ? null
        : { id, name: 'Mazda', toolAllowlist: opts.toolAllowlist ?? null },
    ),
  };
  return {
    service: new TemplateToolPolicyService(
      agents as unknown as IAgentGateway,
      templates as unknown as ITemplateGateway,
    ),
    agents,
    templates,
  };
}

describe('TemplateToolPolicyService', () => {
  it('answers the template list for an agent of a template that has one', async () => {
    const { service } = build({
      toolAllowlist: ['query_knowledge', 'list_knowledge_documents'],
    });
    const allowed = await service.allowedToolsFor(agentReq('a1'));
    expect([...(allowed ?? [])]).toEqual([
      'query_knowledge',
      'list_knowledge_documents',
    ]);
  });

  it('answers null (every tool) for a template without a list, so Rancher and existing templates are unchanged', async () => {
    const { service } = build({ toolAllowlist: null });
    expect(await service.allowedToolsFor(agentReq('a1'))).toBeNull();
  });

  it('answers null for a person, an agent without a template, and a missing template', async () => {
    expect(await build({}).service.allowedToolsFor(personReq())).toBeNull();
    expect(
      await build({ templateId: null }).service.allowedToolsFor(agentReq('a1')),
    ).toBeNull();
    expect(
      await build({ template: false }).service.allowedToolsFor(agentReq('a1')),
    ).toBeNull();
  });

  it('reads the database once per request, however many times it is asked', async () => {
    const { service, agents, templates } = build({
      toolAllowlist: ['query_knowledge'],
    });
    const req = agentReq('a1');
    await service.allowedToolsFor(req);
    await service.allowedToolsFor(req);
    expect(agents.findById).toHaveBeenCalledTimes(1);
    expect(templates.findById).toHaveBeenCalledTimes(1);
  });
});
