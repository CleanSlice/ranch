import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ISettingGateway } from '#/setting/domain';
import {
  IKnowledgeConfig,
  IKnowledgeConfigGateway,
  ISelectedCredentialIds,
} from '../domain/knowledgeConfig.gateway';

const SETTING_GROUP = 'knowledge';

@Injectable()
export class KnowledgeConfigGateway extends IKnowledgeConfigGateway {
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

    return { url, apiKey, bucket, enabled };
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.resolve();
    return config.enabled;
  }

  async isInstanceIsolationEnabled(): Promise<boolean> {
    const setting = await this.settings.findByKey(
      SETTING_GROUP,
      'instance_isolation',
    );
    const explicit = readBoolean(setting?.value);
    if (explicit !== null) return explicit;
    return this.env.get<string>('REINS_INSTANCE_ISOLATION', '') === 'true';
  }

  async getSelectedCredentialIds(): Promise<ISelectedCredentialIds> {
    const [chatSetting, embeddingSetting] = await Promise.all([
      this.settings.findByKey(SETTING_GROUP, 'chat_credential_id'),
      this.settings.findByKey(SETTING_GROUP, 'embedding_credential_id'),
    ]);
    return {
      chat: readString(chatSetting?.value),
      embedding: readString(embeddingSetting?.value),
    };
  }

  async isSharedPoolDecommissioned(): Promise<boolean> {
    const setting = await this.settings.findByKey(
      SETTING_GROUP,
      'shared_pool_decommissioned',
    );
    return readBoolean(setting?.value) === true;
  }

  async markSharedPoolDecommissioned(): Promise<void> {
    await this.settings.upsert(SETTING_GROUP, 'shared_pool_decommissioned', {
      valueType: 'json',
      value: true,
    });
  }

  async isOcrEnabled(): Promise<boolean> {
    const setting = await this.settings.findByKey(SETTING_GROUP, 'ocr_enabled');
    const explicit = readBoolean(setting?.value);
    if (explicit !== null) return explicit;
    const env = readBoolean(this.env.get<string>('REINS_OCR_ENABLED', ''));
    return env ?? DEFAULT_OCR_ENABLED;
  }

  async getOcrMaxPages(): Promise<number> {
    const setting = await this.settings.findByKey(
      SETTING_GROUP,
      'ocr_max_pages',
    );
    const explicit = readPositiveInteger(setting?.value);
    if (explicit !== null) return explicit;
    const env = readPositiveInteger(
      this.env.get<string>('REINS_OCR_MAX_PAGES', ''),
    );
    return env ?? DEFAULT_OCR_MAX_PAGES;
  }
}

const DEFAULT_OCR_ENABLED = true;
// Nothing in the corpus is near this, and a mis-uploaded 2000-page scan
// should ask before it costs money. Textract's own ceiling is 3000.
const DEFAULT_OCR_MAX_PAGES = 500;

function readPositiveInteger(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
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
