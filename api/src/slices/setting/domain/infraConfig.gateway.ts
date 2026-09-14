/**
 * Resolves infrastructure configuration with the precedence:
 *   settings (group=`infrastructure`) → process.env → built-in default.
 *
 * Centralises every value that is environment-dependent but should be
 * reconfigurable at runtime without rebuilding the image (Argo URL,
 * agents namespace, LightRAG URL, etc). Bootstrap values like
 * DATABASE_URL or JWT_SECRET stay in env.
 *
 * The implementation is expected to cache reads with a short TTL so
 * each request doesn't trigger a SQL roundtrip.
 */
export type WorkflowProviderTypes = 'argo' | 'mock';

export abstract class IInfraConfigGateway {
  abstract getArgoUrl(): Promise<string>;
  abstract getWorkflowProvider(): Promise<WorkflowProviderTypes>;
  abstract getAgentsNamespace(): Promise<string>;
  abstract getKubeSkipTlsVerify(): Promise<boolean>;
  abstract getLightragUrl(): Promise<string>;
  abstract getLightragApiKey(): Promise<string>;
  abstract getReinsBucket(): Promise<string>;

  /**
   * Public origin other agents and browsers reach this API on. Feeds the A2A
   * agent-card URLs (CLEAN-74) and, in spirit, the OAuth callback of CLEAN-75.
   * Resolution adds one step to the usual chain: settings → env PUBLIC_API_URL
   * → the `integrations.ranch_api_url` value agents already dial → localhost.
   * Returned without a trailing slash.
   */
  abstract getApiPublicUrl(): Promise<string>;

  /**
   * Drop the in-memory cache. Useful when settings are upserted via the
   * settings controller and we want subsequent reads to see fresh values.
   */
  abstract invalidate(): void;
}
