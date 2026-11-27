import type { IAgentGateway } from '#/agent/agent/domain/agent.gateway';
import type { ITemplateGateway } from '#/agent/template/domain';
import { AssistantBuildService } from '../assistantBuild.service';

/**
 * The real rule over a Ranch that has no assistant and no template: nothing
 * is an ingredient except the ids the code names itself (the Rancher
 * template, the built-in tool servers). For a spec whose subject is not this
 * rule and whose controller needs one.
 */
export function noAssistantBuild(): AssistantBuildService {
  return new AssistantBuildService(
    { findAdmin: () => Promise.resolve(null) } as unknown as IAgentGateway,
    { findById: () => Promise.resolve(null) } as unknown as ITemplateGateway,
  );
}
