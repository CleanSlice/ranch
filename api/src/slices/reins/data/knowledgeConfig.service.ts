import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISettingGateway } from '#/setting/domain';
import {
  IKnowledgeConfig,
  IKnowledgeConfigService,
} from '../domain/knowledgeConfig.service';

const SETTING_GROUP = 'knowledge';

@Injectable()
export class KnowledgeConfigService extends IKnowledgeConfigService {
  constructor(
    private readonly settings: ISettingGateway,
    private readonly env: ConfigService,
  ) {
    super();
  }

  async resolve(): Promise<IKnowledgeConfig> {
    const [urlSetting, apiKeySetting, bucketSetting, enabledSetting] =
      await Promise.all([
        this.settings.findByKey(SETTING_GROUP, 'url'),
        this.settings.findByKey(SETTING_GROUP, 'api_key'),
        this.settings.findByKey(SETTING_GROUP, 's3_bucket'),
        this.settings.findByKey(SETTING_GROUP, 'enabled'),
      ]);

    const url =
      readString(urlSetting?.value) ?? this.env.get<string>('LIGHTRAG_URL', '');
    const apiKey =
      readString(apiKeySetting?.value) ??
      this.env.get<string>('LIGHTRAG_API_KEY', '');
    const bucket =
      readString(bucketSetting?.value) ??
      this.env.get<string>('REINS_S3_BUCKET', '');

    const explicitFlag = readBoolean(enabledSetting?.value);
    const allowed = explicitFlag !== false;
    const enabled = allowed && url.length > 0;

    return {
      url,
      apiKey,
      bucket,
      enabled,
    };
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.resolve();
    return config.enabled;
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  return null;
}
