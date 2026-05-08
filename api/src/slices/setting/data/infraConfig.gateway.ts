import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IInfraConfigGateway,
  WorkflowProviderTypes,
} from '../domain/infraConfig.gateway';
import { ISettingGateway } from '../domain/setting.gateway';

const GROUP = 'infrastructure';
const CACHE_TTL_MS = 30_000;

interface KeySpec<T> {
  setting: string;
  env: string;
  default: T;
  parse: (raw: string) => T;
}

const KEYS = {
  argo_url: {
    setting: 'argo_url',
    env: 'ARGO_WORKFLOWS_URL',
    default: 'http://argo-workflows-server.argo.svc.cluster.local:2746',
    parse: (s: string) => s,
  } as KeySpec<string>,
  workflow_provider: {
    setting: 'workflow_provider',
    env: 'WORKFLOW_PROVIDER',
    default: 'argo' as WorkflowProviderTypes,
    parse: (s: string) =>
      (s.toLowerCase() === 'mock' ? 'mock' : 'argo') as WorkflowProviderTypes,
  } as KeySpec<WorkflowProviderTypes>,
  agents_namespace: {
    setting: 'agents_namespace',
    env: 'AGENTS_NAMESPACE',
    default: 'agents',
    parse: (s: string) => s,
  } as KeySpec<string>,
  kube_skip_tls_verify: {
    setting: 'kube_skip_tls_verify',
    env: 'KUBE_INSECURE',
    default: false,
    parse: (s: string) => s.toLowerCase() === 'true',
  } as KeySpec<boolean>,
  lightrag_url: {
    setting: 'lightrag_url',
    env: 'LIGHTRAG_URL',
    default: 'http://localhost:9621',
    parse: (s: string) => s,
  } as KeySpec<string>,
  lightrag_api_key: {
    setting: 'lightrag_api_key',
    env: 'LIGHTRAG_API_KEY',
    default: 'dev-secret-change-me',
    parse: (s: string) => s,
  } as KeySpec<string>,
  reins_bucket: {
    setting: 'reins_bucket',
    env: 'REINS_S3_BUCKET',
    default: 'ranch-reins-sources',
    parse: (s: string) => s,
  } as KeySpec<string>,
};

type KeyName = keyof typeof KEYS;

@Injectable()
export class InfraConfigGateway
  extends IInfraConfigGateway
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(InfraConfigGateway.name);
  private cache = new Map<KeyName, { value: unknown; expiresAt: number }>();

  constructor(
    private settings: ISettingGateway,
    private config: ConfigService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Tolerate missing DB (e.g. swagger-spec generation in Docker build runs
    // the full Nest lifecycle without DATABASE_URL). Seed is best-effort.
    try {
      await this.seedDefaults();
    } catch (err) {
      this.logger.warn(`Skipping infra config seed: ${(err as Error).message}`);
    }
  }

  invalidate(): void {
    this.cache.clear();
  }

  getArgoUrl(): Promise<string> {
    return this.resolve('argo_url');
  }
  getWorkflowProvider(): Promise<WorkflowProviderTypes> {
    return this.resolve('workflow_provider');
  }
  getAgentsNamespace(): Promise<string> {
    return this.resolve('agents_namespace');
  }
  getKubeSkipTlsVerify(): Promise<boolean> {
    return this.resolve('kube_skip_tls_verify');
  }
  getLightragUrl(): Promise<string> {
    return this.resolve('lightrag_url');
  }
  getLightragApiKey(): Promise<string> {
    return this.resolve('lightrag_api_key');
  }
  getReinsBucket(): Promise<string> {
    return this.resolve('reins_bucket');
  }

  private async resolve<K extends KeyName>(
    key: K,
  ): Promise<(typeof KEYS)[K]['default']> {
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value as (typeof KEYS)[K]['default'];
    }

    const spec = KEYS[key];
    // Tolerate DB outages (e.g. swagger gen during Docker build): fall through
    // to env/default below instead of failing module instantiation. Module
    // useFactory providers call resolve() at startup before the DB is up.
    let settingValue: string | null = null;
    try {
      const setting = await this.settings.findByKey(GROUP, spec.setting);
      settingValue =
        typeof setting?.value === 'string' && setting.value.length > 0
          ? setting.value
          : null;
    } catch (err) {
      this.logger.warn(
        `Settings DB unavailable for "${spec.setting}", falling back to env/default: ${(err as Error).message}`,
      );
    }
    const envValue = this.config.get<string>(spec.env) ?? null;

    let value: unknown;
    if (settingValue !== null) {
      value = spec.parse(settingValue);
    } else if (envValue !== null && envValue !== '') {
      value = spec.parse(envValue);
    } else {
      value = spec.default;
    }

    this.cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
    return value as (typeof KEYS)[K]['default'];
  }

  /**
   * On first boot: for every key not yet present in settings, seed it with
   * the env value (if set) so the runtime-editable settings UI reflects the
   * current effective config. Idempotent — never overwrites existing rows.
   */
  private async seedDefaults(): Promise<void> {
    const existing = new Set(
      (await this.settings.findByGroup(GROUP)).map((s) => s.name),
    );
    const created: string[] = [];
    for (const spec of Object.values(KEYS) as KeySpec<unknown>[]) {
      if (existing.has(spec.setting)) continue;
      const envValue = this.config.get<string>(spec.env);
      if (envValue === undefined || envValue === '') continue;
      await this.settings.upsert(GROUP, spec.setting, {
        valueType: 'string',
        value: envValue,
      });
      created.push(spec.setting);
    }
    if (created.length > 0) {
      this.logger.log(
        `Seeded ${created.length} infrastructure settings from env: ${created.join(', ')}`,
      );
    }
  }
}
