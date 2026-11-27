import type { ITemplateData } from '#template/domain';
import type { IAssistantSettingDrift, IRancherStatus } from './rancher.types';

/** Contract for the Rancher bootstrap API. Implemented by `RancherGateway`. */
export abstract class IRancherGateway {
  abstract status(): Promise<IRancherStatus | null>;
  abstract ensureTemplate(): Promise<ITemplateData>;
  /** Owner only: the settings kept back from the assistant (CLEAN-271). */
  abstract settingsDrift(): Promise<IAssistantSettingDrift[]>;
  /**
   * Owner only: make the live values of exactly these settings, as they were
   * listed, the ones the assistant is deployed from. Refused when the list
   * changed since (409 SETTINGS_CHANGED).
   */
  abstract applySettings(shown: IAssistantSettingDrift[]): Promise<string[]>;
}
