import type { ITemplateData } from '#template/domain';
import type { IRancherGateway } from './rancher.gateway';
import type { IRancherStatus } from './rancher.types';

/** Domain service for the Rancher bootstrap status. */
export class RancherService {
  constructor(private gateway: IRancherGateway) {}

  status(): Promise<IRancherStatus | null> {
    return this.gateway.status();
  }

  ensureTemplate(): Promise<ITemplateData> {
    return this.gateway.ensureTemplate();
  }
}
