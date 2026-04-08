import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IWorkflowGateway,
  ISubmitWorkflowData,
} from '../domain/IWorkflowGateway';
import { IWorkflowStatus } from '../domain/workflow.types';

@Injectable()
export class ArgoWorkflowGateway extends IWorkflowGateway {
  private readonly logger = new Logger(ArgoWorkflowGateway.name);
  private readonly argoUrl: string;

  constructor(private config: ConfigService) {
    super();
    this.argoUrl =
      this.config.get<string>('ARGO_WORKFLOWS_URL') ||
      'http://argo-workflows-server.argo:2746';
  }

  async submit(data: ISubmitWorkflowData): Promise<string> {
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
            { name: 'agent-config', value: JSON.stringify(data.config) },
            { name: 'cpu-limit', value: data.resources.cpu },
            { name: 'memory-limit', value: data.resources.memory },
          ],
        },
      },
    };

    const response = await fetch(
      `${this.argoUrl}/api/v1/workflows/agents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow }),
      },
    );

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
