import { Injectable } from '@nestjs/common';
import { ISettingGateway } from '#/setting/domain';
import {
  IRlmConfigGateway,
  IRlmModelPair,
} from '../domain/rlmConfig.gateway';

const SETTING_GROUP = 'rlm';
const DEFAULT_MAX_ITERATIONS = 8;
const DEFAULT_TIMEOUT_S = 60;

@Injectable()
export class RlmConfigGateway extends IRlmConfigGateway {
  constructor(private readonly settings: ISettingGateway) {
    super();
  }

  async isEnabled(): Promise<boolean> {
    const setting = await this.settings.findByKey(SETTING_GROUP, 'enabled');
    const explicit = readBoolean(setting?.value);
    // Default on, same "explicit opt-out" idiom as KnowledgeConfigGateway —
    // absent setting means "not configured yet", not "disabled".
    return explicit !== false;
  }

  async getModelPair(): Promise<IRlmModelPair> {
    const [rootSetting, subSetting] = await Promise.all([
      this.settings.findByKey(SETTING_GROUP, 'root_credential_id'),
      this.settings.findByKey(SETTING_GROUP, 'sub_credential_id'),
    ]);
    return {
      rootCredentialId: readString(rootSetting?.value),
      subCredentialId: readString(subSetting?.value),
    };
  }

  async getMaxIterations(): Promise<number> {
    const setting = await this.settings.findByKey(
      SETTING_GROUP,
      'max_iterations',
    );
    return readNumber(setting?.value) ?? DEFAULT_MAX_ITERATIONS;
  }

  async getTimeoutS(): Promise<number> {
    const setting = await this.settings.findByKey(SETTING_GROUP, 'timeout_s');
    return readNumber(setting?.value) ?? DEFAULT_TIMEOUT_S;
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
