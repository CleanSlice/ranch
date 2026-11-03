import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { CallerToolPolicy } from '#/mcp/interfaces/caller-tool-policy.interface';
import { callerAgentId } from '#/mcp/tooling';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from './template.gateway';

/**
 * The template's tool allowlist, answered per caller (CLEAN-209).
 *
 * An agent runtime calls the Documents MCP with a service token naming its
 * agent; the agent names its template; the template may carry a list. People
 * and operators at the console are not agents and see every tool. A template
 * without a list — every template until an operator sets one, Rancher's
 * included — answers null, which the catalogue reads as "every tool".
 *
 * tools/list and tools/call both ask during one request; the answer is
 * memoised on the request so the two database reads happen once.
 */
@Injectable()
export class TemplateToolPolicyService extends CallerToolPolicy {
  private readonly memo = new WeakMap<Request, Promise<Set<string> | null>>();

  constructor(
    private readonly agents: IAgentGateway,
    private readonly templates: ITemplateGateway,
  ) {
    super();
  }

  allowedToolsFor(httpRequest: Request): Promise<Set<string> | null> {
    let pending = this.memo.get(httpRequest);
    if (!pending) {
      pending = this.resolve(httpRequest);
      this.memo.set(httpRequest, pending);
    }
    return pending;
  }

  private async resolve(httpRequest: Request): Promise<Set<string> | null> {
    const agentId = callerAgentId(httpRequest);
    if (!agentId) return null;
    const agent = await this.agents.findById(agentId);
    if (!agent?.templateId) return null;
    const template = await this.templates.findById(agent.templateId);
    const list = template?.toolAllowlist ?? null;
    return list === null ? null : new Set(list);
  }
}
