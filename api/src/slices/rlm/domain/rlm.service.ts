import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IAgentGateway } from '#/agent/agent/domain';
import { ITemplateGateway } from '#/agent/template/domain';
import { ILlmGateway } from '#/llm/domain';
import { normalizeCredential } from '#/llm/domain/llm.utils';
import { ISettingGateway } from '#/setting/domain';
import { ISourceGateway } from '#/reins/source/domain';
import { AuthService } from '#/user/auth/domain';
import { IRlmConfigGateway } from '../config/domain/rlmConfig.gateway';
import { IRlmContextRef, IRlmExecuteInput, IRlmJobResult } from './rlm.types';
import { IRlmExecutorGateway, IRlmModelSpec } from './rlm-executor.gateway';

// Workspace-only — never memory/, sessions/, data/ (may hold secrets/PII).
// Mirrors S3FileGateway's AGENT_OWNED_PREFIXES split but scoped tighter:
// RLM only ever gets read access to the one prefix an operator would
// consider "safe to hand an LLM that recursively re-queries itself".
const ALLOWED_FILE_PREFIX = 'workspace/';

// Same integrations-group default ArgoWorkflowGateway falls back to — kept
// local (not exported from workflow/) to avoid importing that slice here.
const DEFAULT_RANCH_API_URL = 'http://host.k3d.internal:3333';

export class RlmDisabledError extends Error {}
export class RlmNotConfiguredError extends Error {}
export class RlmContextDeniedError extends Error {}

@Injectable()
export class RlmService {
  private readonly logger = new Logger(RlmService.name);

  constructor(
    private readonly config: IRlmConfigGateway,
    private readonly executor: IRlmExecutorGateway,
    private readonly llmGateway: ILlmGateway,
    private readonly agentGateway: IAgentGateway,
    private readonly templateGateway: ITemplateGateway,
    private readonly sourceGateway: ISourceGateway,
    private readonly settings: ISettingGateway,
    private readonly auth: AuthService,
  ) {}

  /**
   * Resolves the knowledge ids a given agent is allowed to reference —
   * agent-level override if set, else the template's default. Exported so
   * rlm.tool.ts can validate/default the caller's request before it ever
   * reaches execute().
   */
  async resolveAllowedKnowledgeIds(agentId: string): Promise<string[]> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return [];
    if (agent.knowledgeIds.length > 0) return agent.knowledgeIds;
    const template = await this.templateGateway.findById(agent.templateId);
    return template?.defaultKnowledgeIds ?? [];
  }

  async execute(
    callerAgentId: string,
    input: IRlmExecuteInput,
  ): Promise<IRlmJobResult> {
    if (!(await this.config.isEnabled())) {
      throw new RlmDisabledError('RLM is disabled platform-wide.');
    }

    const agent = await this.agentGateway.findById(callerAgentId);
    if (!agent) {
      throw new RlmContextDeniedError(`Agent ${callerAgentId} not found.`);
    }
    const template = await this.templateGateway.findById(agent.templateId);
    if (!template) {
      throw new RlmContextDeniedError(
        `Template ${agent.templateId} not found.`,
      );
    }

    const allowedKnowledgeIds = await this.resolveAllowedKnowledgeIds(
      callerAgentId,
    );
    await this.assertContextAllowed(
      callerAgentId,
      allowedKnowledgeIds,
      input.contextRefs,
    );

    const [root, sub] = await Promise.all([
      this.resolveModel('root'),
      this.resolveModel('sub'),
    ]);

    const jobId = randomUUID();
    const scope = {
      jobId,
      agentId: callerAgentId,
      knowledgeIds: input.contextRefs
        .filter((r) => r.type === 'knowledge')
        .map((r) => r.knowledgeId),
      sourceIds: input.contextRefs
        .filter((r) => r.type === 'source')
        .map((r) => r.sourceId),
      filePrefix: ALLOWED_FILE_PREFIX,
    };
    const rlmJobToken = await this.auth.issueRlmJobToken(scope);

    const [ranchApiUrl, maxIterations, timeoutS] = await Promise.all([
      this.getIntegration('ranch_api_url'),
      this.config.getMaxIterations(),
      this.config.getTimeoutS(),
    ]);

    const workflowName = await this.executor.submit({
      jobId,
      question: input.question,
      contextRefs: input.contextRefs,
      maxIterations,
      timeoutS,
      root,
      sub,
      ranchApiUrl,
      rlmJobToken,
      image: template.image,
      imagePullPolicy: 'Always',
    });

    this.logger.log(
      `RLM job ${jobId} (agent=${callerAgentId}) submitted as ${workflowName}`,
    );

    // A little headroom over the job's own activeDeadlineSeconds so a
    // pod that's killed at the deadline still gets its status polled at
    // least once before we give up waiting on this side too.
    return this.executor.awaitResult(
      workflowName,
      jobId,
      (timeoutS + 15) * 1000,
    );
  }

  private async assertContextAllowed(
    callerAgentId: string,
    allowedKnowledgeIds: string[],
    refs: IRlmContextRef[],
  ): Promise<void> {
    for (const ref of refs) {
      if (ref.type === 'knowledge') {
        if (!allowedKnowledgeIds.includes(ref.knowledgeId)) {
          throw new RlmContextDeniedError(
            `Knowledge ${ref.knowledgeId} is not bound to this agent.`,
          );
        }
      } else if (ref.type === 'source') {
        const source = await this.sourceGateway.findById(ref.sourceId);
        if (!source || !allowedKnowledgeIds.includes(source.knowledgeId)) {
          throw new RlmContextDeniedError(
            `Source ${ref.sourceId} is not part of a knowledge base bound to this agent.`,
          );
        }
      } else if (ref.type === 'agentFile') {
        if (ref.agentId !== callerAgentId) {
          throw new RlmContextDeniedError(
            'agentFile context can only reference the calling agent itself.',
          );
        }
        if (!ref.path.startsWith(ALLOWED_FILE_PREFIX)) {
          throw new RlmContextDeniedError(
            `agentFile paths must start with "${ALLOWED_FILE_PREFIX}".`,
          );
        }
      }
    }
  }

  private async resolveModel(which: 'root' | 'sub'): Promise<IRlmModelSpec> {
    const pair = await this.config.getModelPair();
    const credentialId =
      which === 'root' ? pair.rootCredentialId : pair.subCredentialId;
    if (!credentialId) {
      throw new RlmNotConfiguredError(
        `RLM ${which} model is not configured (settings -> RLM).`,
      );
    }
    const credential = await this.llmGateway.findById(credentialId);
    if (!credential) {
      throw new RlmNotConfiguredError(
        `RLM ${which} model credential ${credentialId} no longer exists.`,
      );
    }
    return {
      provider: credential.provider,
      model: credential.model,
      fallbackModel: credential.fallbackModel ?? credential.model,
      apiKey: normalizeCredential(credential.apiKey),
    };
  }

  // Same 'integrations' setting group ArgoWorkflowGateway reads from, kept
  // as a tiny local copy rather than importing the workflow slice (which
  // would import this slice back for shouldInjectRlm - see rlm.module.ts).
  private async getIntegration(name: string): Promise<string> {
    const setting = await this.settings.findByKey('integrations', name);
    const value = typeof setting?.value === 'string' ? setting.value : '';
    return value || DEFAULT_RANCH_API_URL;
  }
}
