import { Injectable } from '@nestjs/common';
import { IInfraConfigGateway } from '#/setting/domain';
import {
  IInstanceGateway,
  IProvisionInstanceData,
} from '../domain/instance.gateway';
import { IInstanceStatus } from '../domain/instance.types';
import { ArgoInstanceGateway } from './argoInstance.gateway';
import { MockInstanceGateway } from './mockInstance.gateway';

// Instances ride the same provider switch as agent workflows: a dev setup
// that mocks agent deployment has no cluster for retrieval instances either.
@Injectable()
export class RouterInstanceGateway extends IInstanceGateway {
  constructor(
    private readonly infraConfig: IInfraConfigGateway,
    private readonly argo: ArgoInstanceGateway,
    private readonly mock: MockInstanceGateway,
  ) {
    super();
  }

  private async pick(): Promise<IInstanceGateway> {
    const provider = await this.infraConfig.getWorkflowProvider();
    return provider === 'mock' ? this.mock : this.argo;
  }

  async ensureCapacityForNew(): Promise<void> {
    return (await this.pick()).ensureCapacityForNew();
  }
  async provision(data: IProvisionInstanceData): Promise<IInstanceStatus> {
    return (await this.pick()).provision(data);
  }
  async status(knowledgeId: string): Promise<IInstanceStatus> {
    return (await this.pick()).status(knowledgeId);
  }
  async list(): Promise<IInstanceStatus[]> {
    return (await this.pick()).list();
  }
  async terminate(knowledgeId: string): Promise<void> {
    return (await this.pick()).terminate(knowledgeId);
  }
}
