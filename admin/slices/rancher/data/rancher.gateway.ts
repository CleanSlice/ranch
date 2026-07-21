import { RancherService as RancherApi } from '#api/data';
import type { ITemplateData } from '#template/domain';
import { BaseGateway } from '#common/data/BaseGateway';
import { unwrapEnvelope } from '#common/data/unwrapEnvelope';
import { IRancherGateway } from '../domain/rancher.gateway';
import type { IRancherStatus } from '../domain/rancher.types';
import { RancherMapper } from './rancher.mapper';

export class RancherGateway extends BaseGateway implements IRancherGateway {
  private mapper = new RancherMapper();

  status(): Promise<IRancherStatus | null> {
    return this.execute(async () => {
      const res = await RancherApi.rancherControllerStatus();
      return this.mapper.toStatus(unwrapEnvelope(res.data));
    });
  }

  ensureTemplate(): Promise<ITemplateData> {
    return this.execute(async () => {
      const res = await RancherApi.rancherControllerEnsureTemplate();
      const err = (res as { error?: { message?: string } }).error;
      if (err) {
        throw new Error(err.message ?? 'Failed to create Rancher template');
      }
      const template = this.mapper.toTemplate(unwrapEnvelope(res.data));
      if (!template) throw new Error('Ensure template returned no data');
      return template;
    });
  }
}
