import { Injectable, Logger } from '@nestjs/common';
import {
  IWorkflowGateway,
  ISubmitWorkflowData,
} from '../domain/IWorkflowGateway';
import { IWorkflowStatus, IAgentEnvVar } from '../domain/workflow.types';
import { IInfraConfigGateway, ISettingGateway } from '#/setting/domain';
import { ILlmGateway } from '#/llm/domain';
import { normalizeCredential } from '#/llm/domain/llm.utils';
import { ITemplateGateway } from '#/agent/template/domain';
import { IMcpServerGateway, IMcpServerData } from '#/mcpServer/domain';
import { IKnowledgeGateway } from '#/reins/knowledge/domain';
import { IKnowledgeConfigGateway } from '#/reins/config/domain';
import { IRlmConfigGateway } from '#/rlm/config/domain/rlmConfig.gateway';
import {
  CLEANSLICE_MCP_ID,
  KNOWLEDGE_MCP_ID,
  RANCH_MCP_ID,
} from '#/mcpServer/domain/mcpServer.seeder';
import { IAgentChannelGateway } from '#/agent/agentChannel/domain';
import { IUserGateway, UserRoleTypes } from '#/user/user/domain';
import {
  buildAgentWorkflow,
  buildAgentEnv,
  IAgentWorkflowManifestInput,
} from './agent-workflow.manifest';

const DEFAULTS = {
  bridle_url: 'http://host.k3d.internal:3333/ws/agent',
  bridle_api_key: 'dev-bridle-api-key-change-me',
  s3_bucket: '',
  s3_endpoint: '',
  // Endpoint as seen from inside agent pods. When blank, falls back to
  // s3_endpoint. Used because in dev MinIO is reachable from the host as
  // localhost:9000 but from k3d pods only as cleanslice-ranch-minio-1:9000.
  s3_endpoint_agent: '',
  aws_region: 'us-east-1',
  aws_access_key_id: '',
  aws_secret_access_key: '',
  secret_provider: 'file',
  aws_secret_prefix: 'cleanslice/users',
  // Ranch API URL as seen from agent pods. The default targets the host
  // network from inside k3d (matching bridle_url). On a real cluster
  // override via integrations.ranch_api_url, e.g.
  // `http://ranch-api.platform.svc.cluster.local`.
  ranch_api_url: 'http://host.k3d.internal:3333',
};

@Injectable()
export class ArgoWorkflowGateway extends IWorkflowGateway {
  private readonly logger = new Logger(ArgoWorkflowGateway.name);

  constructor(
    private infraConfig: IInfraConfigGateway,
    private settingGateway: ISettingGateway,
    private llmGateway: ILlmGateway,
    private templateGateway: ITemplateGateway,
    private mcpServerGateway: IMcpServerGateway,
    private knowledgeGateway: IKnowledgeGateway,
    private knowledgeConfig: IKnowledgeConfigGateway,
    private rlmConfig: IRlmConfigGateway,
    private channelGateway: IAgentChannelGateway,
    private userGateway: IUserGateway,
  ) {
    super();
  }

  // Agents act on behalf of a Ranch user when reaching back into
  // /integrations/internal/* (cookies belong to a user, not the agent).
  // Single-tenant assumption: the earliest Owner-role user. Multi-tenant
  // setups will need Agent.userId — out of scope for this fix.
  private async resolveOwnerUserId(): Promise<string> {
    const all = await this.userGateway.findAll();
    const owner = all
      .filter((u) => u.roles.includes(UserRoleTypes.Owner))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    return owner?.id ?? 'admin';
  }

  private async getIntegration(name: keyof typeof DEFAULTS): Promise<string> {
    const setting = await this.settingGateway.findByKey('integrations', name);
    const value = typeof setting?.value === 'string' ? setting.value : '';
    return value || DEFAULTS[name];
  }

  /**
   * Resolves the MCP servers attached to the agent's template and serializes
   * them to the wire format the runtime expects (IMcpServerConfig). Auth
   * placeholders like `${RANCH_API_TOKEN}` are substituted with the actual
   * service token minted for this agent. Disabled servers are filtered out.
   */
  private async resolveMcpServers(
    templateId: string,
    effectiveKnowledgeIds: string[],
    ranchApiToken: string,
  ): Promise<unknown[]> {
    const template = await this.templateGateway.findById(templateId);
    const baseServers =
      template && template.mcpServerIds.length > 0
        ? await this.mcpServerGateway.findByIds(template.mcpServerIds)
        : [];

    const enabledServers = baseServers.filter((m) => m.enabled);

    // CleanSlice MCP is built-in and attached to every agent by default,
    // regardless of the template. Operators can disable it by toggling the
    // `enabled` flag on the DB record (or deleting the record entirely).
    if (!enabledServers.some((m) => m.id === CLEANSLICE_MCP_ID)) {
      const cleansliceMcp =
        await this.mcpServerGateway.findById(CLEANSLICE_MCP_ID);
      if (cleansliceMcp && cleansliceMcp.enabled) {
        enabledServers.push(cleansliceMcp);
      }
    }

    const shouldInjectKnowledge = await this.shouldInjectKnowledge(
      effectiveKnowledgeIds,
      enabledServers,
    );
    if (shouldInjectKnowledge) {
      const knowledgeMcp =
        await this.mcpServerGateway.findById(KNOWLEDGE_MCP_ID);
      if (knowledgeMcp && knowledgeMcp.enabled) {
        enabledServers.push(knowledgeMcp);
      }
    }

    // rlm_query is just another @Tool() on this same API - it surfaces
    // through ANY MCP server row whose url points back at this API's own
    // /mcp/mcp endpoint (mcp-ranch and mcp-knowledge both do, see
    // mcpServer.seeder.ts). So no new "mcp-rlm" row: reuse mcp-ranch,
    // auto-attaching it exactly like mcp-knowledge above whenever the
    // platform toggle is on and it isn't already attached some other way.
    if (
      (await this.rlmConfig.isEnabled()) &&
      !enabledServers.some((m) => m.id === RANCH_MCP_ID)
    ) {
      const ranchMcp = await this.mcpServerGateway.findById(RANCH_MCP_ID);
      if (ranchMcp && ranchMcp.enabled) {
        enabledServers.push(ranchMcp);
      }
    }

    return enabledServers.map((m) => this.toRuntimeConfig(m, ranchApiToken));
  }

  private async shouldInjectKnowledge(
    effectiveKnowledgeIds: string[],
    alreadyAttached: IMcpServerData[],
  ): Promise<boolean> {
    if (effectiveKnowledgeIds.length === 0) return false;
    if (alreadyAttached.some((m) => m.id === KNOWLEDGE_MCP_ID)) return false;
    const isEnabled = await this.knowledgeConfig.isEnabled();
    if (!isEnabled) return false;
    const existing = await this.knowledgeGateway.findExistingByIds(
      effectiveKnowledgeIds,
    );
    return existing.length > 0;
  }

  private toRuntimeConfig(server: IMcpServerData, ranchApiToken: string) {
    const value = server.authValue
      ? server.authValue.replace('${RANCH_API_TOKEN}', ranchApiToken)
      : null;
    return {
      name: server.name,
      transport: server.transport,
      url: server.url,
      authType: server.authType,
      authValue: server.authType === 'none' ? null : value,
      enabled: true,
    };
  }

  /**
   * Resolve a deploy request into the fully-baked manifest input —
   * settings, LLM credential, MCP servers and channels all looked up.
   * Shared by `submit` (real deploy) and `previewEnv` (admin UI preview)
   * so the two never drift.
   */
  private async resolveManifestInput(
    data: ISubmitWorkflowData,
  ): Promise<IAgentWorkflowManifestInput> {
    const template = await this.templateGateway.findById(data.templateId);
    const effectiveKnowledgeIds =
      data.knowledgeIds.length > 0
        ? data.knowledgeIds
        : (template?.defaultKnowledgeIds ?? []);
    const [
      bridleUrl,
      bridleApiKey,
      s3Bucket,
      s3Endpoint,
      s3EndpointAgentOverride,
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      secretProvider,
      awsSecretPrefix,
      ranchApiUrl,
      mcpServers,
      channels,
    ] = await Promise.all([
      this.getIntegration('bridle_url'),
      this.getIntegration('bridle_api_key'),
      this.getIntegration('s3_bucket'),
      this.getIntegration('s3_endpoint'),
      this.getIntegration('s3_endpoint_agent'),
      this.getIntegration('aws_region'),
      this.getIntegration('aws_access_key_id'),
      this.getIntegration('aws_secret_access_key'),
      this.getIntegration('secret_provider'),
      this.getIntegration('aws_secret_prefix'),
      this.getIntegration('ranch_api_url'),
      this.resolveMcpServers(
        data.templateId,
        effectiveKnowledgeIds,
        data.ranchApiToken,
      ),
      this.channelGateway.getForAgent(data.agentId),
    ]);
    // Pods use the agent-side endpoint when set, otherwise fall back to the
    // shared one. The API itself keeps using s3_endpoint for its own SDK.
    const s3EndpointForPod = s3EndpointAgentOverride || s3Endpoint;
    const s3Prefix = s3Bucket ? `agents/${data.agentId}` : '';

    // Resolve the agent's assigned LlmCredential (or empty if none) and
    // project it onto the runtime's LLM_* env contract.
    const credential = data.llmCredentialId
      ? await this.llmGateway.findById(data.llmCredentialId)
      : null;

    // AGENT_CONFIG_B64 / MCP_SERVERS_B64 stay base64-encoded because the
    // runtime image reads them that way from env.
    const agentConfigB64 = Buffer.from(JSON.stringify(data.config)).toString(
      'base64',
    );
    const mcpServersB64 = Buffer.from(JSON.stringify(mcpServers)).toString(
      'base64',
    );
    // Default auxiliary model per provider — used by runtime for background
    // work (compaction, memory-flush). Empty string → runtime falls back.
    const provider = credential?.provider?.toLowerCase();
    const auxModelDefault =
      provider === 'claude' || provider === 'anthropic'
        ? 'claude-haiku-4-5'
        : '';

    const telegram = channels.find((c) => c.type === 'telegram');

    const ownerUserId = await this.resolveOwnerUserId();

    return {
      agentId: data.agentId,
      agentName: data.agentName,
      templateId: data.templateId,
      image: data.image,
      imagePullPolicy: 'Always',
      cpu: data.resources.cpu,
      memory: data.resources.memory,
      isAdmin: data.isAdmin,
      debugEnabled: data.debugEnabled,
      ownerUserId,
      ranchApiUrl,
      ranchApiToken: data.ranchApiToken,
      bridleUrl,
      bridleApiKey,
      s3Bucket,
      s3Prefix,
      s3Endpoint: s3EndpointForPod,
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      secretProvider,
      awsSecretPrefix,
      agentConfigB64,
      mcpServersB64,
      llm: {
        provider: credential?.provider ?? '',
        model: credential?.model ?? '',
        fallbackModel: credential?.fallbackModel ?? credential?.model ?? '',
        apiKey: credential?.apiKey
          ? normalizeCredential(credential.apiKey)
          : '',
        auxProvider: '',
        auxModel: auxModelDefault,
        auxFallbackModel: '',
        auxApiKey: '',
      },
      telegram: {
        botToken: telegram?.config.botToken ?? '',
        botName: telegram?.config.botName ?? '',
        adminIds: telegram?.config.adminIds ?? '',
      },
    };
  }

  /**
   * The env vars an agent pod would receive on its next deploy — built
   * by the SAME resolution + `buildAgentEnv` as a real submit. Backs the
   * admin "Environment" panel so it can never drift from the pod spec.
   * Secret values are returned verbatim (the caller is an authed admin,
   * same exposure as before); the UI masks them for display.
   */
  async previewEnv(data: ISubmitWorkflowData): Promise<IAgentEnvVar[]> {
    return buildAgentEnv(await this.resolveManifestInput(data));
  }

  async submit(data: ISubmitWorkflowData): Promise<string> {
    const workflow = buildAgentWorkflow(await this.resolveManifestInput(data));

    const argoUrl = await this.infraConfig.getArgoUrl();
    const response = await fetch(`${argoUrl}/api/v1/workflows/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to submit workflow: ${error}`);
      throw new Error(`Failed to submit workflow: ${response.statusText}`);
    }

    const result = await response.json();
    return result.metadata.name;
  }

  async cancel(workflowId: string): Promise<void> {
    const argoUrl = await this.infraConfig.getArgoUrl();
    await fetch(`${argoUrl}/api/v1/workflows/agents/${workflowId}/terminate`, {
      method: 'PUT',
    });
  }

  async getStatus(workflowId: string): Promise<IWorkflowStatus> {
    const argoUrl = await this.infraConfig.getArgoUrl();
    const response = await fetch(
      `${argoUrl}/api/v1/workflows/agents/${workflowId}`,
    );
    const data = await response.json();

    return {
      name: data.metadata.name,
      phase: data.status.phase,
      startedAt: data.status.startedAt || null,
      finishedAt: data.status.finishedAt || null,
    };
  }

  async getLogs(workflowId: string): Promise<string> {
    const argoUrl = await this.infraConfig.getArgoUrl();
    const response = await fetch(
      `${argoUrl}/api/v1/workflows/agents/${workflowId}/log`,
    );
    return response.text();
  }
}
