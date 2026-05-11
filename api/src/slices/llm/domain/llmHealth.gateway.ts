import { ILlmCredentialData } from './llm.types';

export interface ILlmHealthCheckResult {
  ok: boolean;
  latencyMs: number;
  provider: string;
  model: string;
  error?: string;
}

export abstract class ILlmHealthGateway {
  abstract check(
    credential: ILlmCredentialData,
  ): Promise<ILlmHealthCheckResult>;
}
