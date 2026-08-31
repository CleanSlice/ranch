import type {
  ILightragCallContext,
  LightragRequestConfig,
} from './lightragHttp.client';

export interface IKnowledgeRoutingRow {
  migrationState: string;
  instanceState: string;
  instanceEndpoint: string | null;
}

/**
 * The one place that decides which endpoint a LightRAG call hits during and
 * after the transition off the shared pool:
 *
 * - migrated base ('done'): its own instance, for reads AND writes. Never
 *   falls back to the shared pool — a fallback would silently serve another
 *   era's content, which is the exact leak this feature removes. Instance
 *   down → disabled, so the failure is reported instead of papered over.
 * - unmigrated base: reads stay on the shared pool (it still holds the
 *   content); writes go to the base's own instance as soon as it is ready —
 *   that is how the migration re-ingests without flipping reads early.
 * - no context: shared/legacy endpoint (health checks).
 */
export function routeLightragConfig(
  shared: LightragRequestConfig,
  knowledge: IKnowledgeRoutingRow | null,
  ctx?: ILightragCallContext,
): LightragRequestConfig {
  if (!ctx || !knowledge) return shared;

  const own =
    knowledge.instanceState === 'ready' && knowledge.instanceEndpoint
      ? knowledge.instanceEndpoint
      : null;

  if (knowledge.migrationState === 'done') {
    return {
      url: own ?? '',
      apiKey: shared.apiKey,
      enabled: shared.enabled && own !== null,
    };
  }
  if (ctx.intent === 'write' && own) {
    return { url: own, apiKey: shared.apiKey, enabled: shared.enabled };
  }
  return shared;
}
