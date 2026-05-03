import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IWorkflowGateway,
  ISubmitWorkflowData,
} from '../domain/IWorkflowGateway';
import { IWorkflowStatus } from '../domain/workflow.types';
import { ISettingGateway } from '#/setting/domain';
import { ILlmGateway } from '#/llm/domain';
import { normalizeCredential } from '#/llm/domain/llm.utils';
import { ITemplateGateway } from '#/agent/template/domain';
import { IMcpServerGateway, IMcpServerData } from '#/mcpServer/domain';

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
  // Ranch API URL as seen from agent pods (in-cluster). Defaults to the
  // API service inside k8s. Override via integrations.ranch_api_url.
  ranch_api_url: 'http://api:3001',
};

@Injectable()
export class ArgoWorkflowGateway extends IWorkflowGateway {
  private readonly logger = new Logger(ArgoWorkflowGateway.name);
  private readonly argoUrl: string;

  constructor(
    private config: ConfigService,
    private settingGateway: ISettingGateway,
    private llmGateway: ILlmGateway,
    private templateGateway: ITemplateGateway,
    private mcpServerGateway: IMcpServerGateway,
  ) {
    super();
    this.argoUrl =
      this.config.get<string>('ARGO_WORKFLOWS_URL') ||
      'http://argo-workflows-server.argo:2746';
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
    ranchApiToken: string,
  ): Promise<unknown[]> {
    const template = await this.templateGateway.findById(templateId);
    if (!template || template.mcpServerIds.length === 0) return [];
    const servers = await this.mcpServerGateway.findByIds(
      template.mcpServerIds,
    );
    return servers
      .filter((m) => m.enabled)
      .map((m) => this.toRuntimeConfig(m, ranchApiToken));
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

  async submit(data: ISubmitWorkflowData): Promise<string> {
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
      this.resolveMcpServers(data.templateId, data.ranchApiToken),
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
    const llmParams = [
      { name: 'llm-provider', value: credential?.provider ?? '' },
      { name: 'llm-model', value: credential?.model ?? '' },
      {
        name: 'llm-fallback-model',
        value: credential?.fallbackModel ?? credential?.model ?? '',
      },
      {
        name: 'llm-api-key',
        value: credential?.apiKey ? normalizeCredential(credential.apiKey) : '',
      },
    ];

    const workflow = {
      apiVersion: 'argoproj.io/v1alpha1',
      kind: 'Workflow',
      metadata: {
        generateName: `agent-${data.agentId}-`,
        namespace: 'agents',
        labels: {
          'ranch/agent-id': data.agentId,
          'ranch/template-id': data.templateId,
        },
      },
      spec: {
        workflowTemplateRef: {
          name: 'agent-deployment',
        },
        arguments: {
          parameters: [
            { name: 'agent-id', value: data.agentId },
            { name: 'agent-name', value: data.agentName },
            { name: 'template-id', value: data.templateId },
            { name: 'agent-image', value: data.image },
            { name: 'agent-config', value: JSON.stringify(data.config) },
            { name: 'cpu-limit', value: data.resources.cpu },
            { name: 'memory-limit', value: data.resources.memory },
            { name: 'bridle-url', value: bridleUrl },
            { name: 'bridle-api-key', value: bridleApiKey },
            { name: 's3-bucket', value: s3Bucket },
            { name: 's3-prefix', value: s3Prefix },
            { name: 's3-endpoint', value: s3EndpointForPod },
            { name: 'aws-region', value: awsRegion },
            { name: 'aws-access-key-id', value: awsAccessKeyId },
            { name: 'aws-secret-access-key', value: awsSecretAccessKey },
            { name: 'secret-provider', value: secretProvider },
            { name: 'aws-secret-prefix', value: awsSecretPrefix },
            { name: 'ranch-admin', value: data.isAdmin ? 'true' : 'false' },
            { name: 'ranch-api-url', value: ranchApiUrl },
            { name: 'ranch-api-token', value: data.ranchApiToken },
            { name: 'mcp-servers', value: JSON.stringify(mcpServers) },
            ...llmParams,
          ],
        },
      },
    };

    const response = await fetch(`${this.argoUrl}/api/v1/workflows/agents`, {
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
    await fetch(
      `${this.argoUrl}/api/v1/workflows/agents/${workflowId}/terminate`,
      { method: 'PUT' },
    );
  }

  async getStatus(workflowId: string): Promise<IWorkflowStatus> {
    const response = await fetch(
      `${this.argoUrl}/api/v1/workflows/agents/${workflowId}`,
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
    const response = await fetch(
      `${this.argoUrl}/api/v1/workflows/agents/${workflowId}/log`,
    );
    return response.text();
  }
}
