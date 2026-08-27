import { Injectable, Logger } from '@nestjs/common';
import { IKnowledgeConfigGateway } from '../../config/domain/knowledgeConfig.gateway';
import {
  IInstanceGateway,
  IProvisionInstanceData,
} from '../domain/instance.gateway';
import { IInstanceStatus } from '../domain/instance.types';

/**
 * Local development: every base shares the docker-compose LightRAG, so the
 * mock reports every instance ready at the single configured endpoint.
 * This means LOCAL DEV DOES NOT REPRODUCE ISOLATION — the guarantee is
 * verified against a cluster (quickstart scenarios 1–2) or the Jest
 * integration test that stands in for one.
 */
@Injectable()
export class MockInstanceGateway extends IInstanceGateway {
  private readonly logger = new Logger(MockInstanceGateway.name);
  private readonly provisioned = new Set<string>();
  private warned = false;

  constructor(private readonly knowledgeConfig: IKnowledgeConfigGateway) {
    super();
  }

  async ensureCapacityForNew(): Promise<void> {
    // The shared local LightRAG has no per-base cost to guard.
  }

  async provision(data: IProvisionInstanceData): Promise<IInstanceStatus> {
    if (!this.warned) {
      this.logger.warn(
        '[mock] all bases share one LightRAG — isolation is NOT reproduced locally',
      );
      this.warned = true;
    }
    this.provisioned.add(data.knowledgeId);
    return this.status(data.knowledgeId);
  }

  async status(knowledgeId: string): Promise<IInstanceStatus> {
    const cfg = await this.knowledgeConfig.resolve();
    if (!cfg.enabled || !cfg.url) {
      return {
        knowledgeId,
        state: 'failed',
        endpoint: null,
        error: 'Knowledge service is not configured',
        observedAt: new Date().toISOString(),
      };
    }
    return {
      knowledgeId,
      state: 'ready',
      endpoint: cfg.url,
      error: null,
      observedAt: new Date().toISOString(),
    };
  }

  async list(): Promise<IInstanceStatus[]> {
    return Promise.all([...this.provisioned].map((id) => this.status(id)));
  }

  async terminate(knowledgeId: string): Promise<void> {
    this.provisioned.delete(knowledgeId);
  }
}
