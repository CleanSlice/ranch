import type { ITemplateData } from '#template/domain';
import type { IRancherStatus } from './rancher.types';

/** Contract for the Rancher bootstrap API. Implemented by `RancherGateway`. */
export abstract class IRancherGateway {
  abstract status(): Promise<IRancherStatus | null>;
  abstract ensureTemplate(): Promise<ITemplateData>;
}
