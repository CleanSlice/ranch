import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IWorkflowGateway,
  ISubmitWorkflowData,
} from '../domain/IWorkflowGateway';
import { IWorkflowStatus } from '../domain/workflow.types';
import { ISettingGateway } from '#/setting/domain';

const DEFAULTS = {
  bridle_url: 'http://host.k3d.internal:3333',
  bridle_api_key: 'dev-bridle-api-key-change-me',
  claude_code_oauth_token: '',
  anthropic_api_key: '',
  s3_bucket: '',
  s3_endpoint: '',
  aws_region: 'us-east-1',
  aws_access_key_id: '',
  aws_secret_access_key: '',
};

@Injectable()
export class ArgoWorkflowGateway extends IWorkflowGateway {
  private readonly logger = new Logger(ArgoWorkflowGateway.name);
  private readonly argoUrl: string;

  constructor(
    private config: ConfigService,
    private settingGateway: ISettingGateway,
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

  async submit(data: ISubmitWorkflowData): Promise<string> {
    const [
      bridleUrl,
      bridleApiKey,
      claudeToken,
      anthropicKey,
      s3Bucket,
      s3Endpoint,
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
    ] = await Promise.all([
      this.getIntegration('bridle_url'),
      this.getIntegration('bridle_api_key'),
      this.getIntegration('claude_code_oauth_token'),
      this.getIntegration('anthropic_api_key'),
      this.getIntegration('s3_bucket'),
      this.getIntegration('s3_endpoint'),
      this.getIntegration('aws_region'),
      this.getIntegration('aws_access_key_id'),
      this.getIntegration('aws_secret_access_key'),
    ]);
    const s3Prefix = s3Bucket ? `agents/${data.agentId}` : '';

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
            { name: 'claude-code-oauth-token', value: claudeToken },
            { name: 'anthropic-api-key', value: anthropicKey },
            { name: 's3-bucket', value: s3Bucket },
            { name: 's3-prefix', value: s3Prefix },
            { name: 's3-endpoint', value: s3Endpoint },
            { name: 'aws-region', value: awsRegion },
            { name: 'aws-access-key-id', value: awsAccessKeyId },
            { name: 'aws-secret-access-key', value: awsSecretAccessKey },
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
