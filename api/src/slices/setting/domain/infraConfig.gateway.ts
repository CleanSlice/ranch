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
   * Drop the in-memory cache. Useful when settings are upserted via the
   * settings controller and we want subsequent reads to see fresh values.
   */
  abstract invalidate(): void;
}
