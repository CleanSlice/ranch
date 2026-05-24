import { Injectable } from '@nestjs/common';
import { IInfraConfigGateway } from '#/setting/domain';
import {
  IWorkflowGateway,
  ISubmitWorkflowData,
} from '../domain/IWorkflowGateway';
import { IWorkflowStatus, IAgentEnvVar } from '../domain/workflow.types';
import { ArgoWorkflowGateway } from './argo-workflow.gateway';
import { MockWorkflowGateway } from './mock-workflow.gateway';

@Injectable()
export class RouterWorkflowGateway extends IWorkflowGateway {
  constructor(
    private infraConfig: IInfraConfigGateway,
    private argo: ArgoWorkflowGateway,
    private mock: MockWorkflowGateway,
  ) {
    super();
  }

  private async pick(): Promise<IWorkflowGateway> {
    const provider = await this.infraConfig.getWorkflowProvider();
    return provider === 'mock' ? this.mock : this.argo;
  }

  async submit(data: ISubmitWorkflowData): Promise<string> {
    return (await this.pick()).submit(data);
  }
  async previewEnv(data: ISubmitWorkflowData): Promise<IAgentEnvVar[]> {
    return (await this.pick()).previewEnv(data);
  }
  async cancel(workflowId: string): Promise<void> {
    return (await this.pick()).cancel(workflowId);
  }
  async getStatus(workflowId: string): Promise<IWorkflowStatus> {
    return (await this.pick()).getStatus(workflowId);
  }
  async getLogs(workflowId: string): Promise<string> {
    return (await this.pick()).getLogs(workflowId);
  }
}
