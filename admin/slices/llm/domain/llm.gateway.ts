import type {
  ILlmCredentialData,
  ILlmCredentialInput,
  ILlmHealthCheckResult,
} from './llm.types';

/** Contract for LLM credentials. Implemented by `LlmGateway`. */
export abstract class ILlmGateway {
  abstract findAll(): Promise<ILlmCredentialData[]>;
  abstract findById(id: string): Promise<ILlmCredentialData | null>;
  abstract create(
    input: ILlmCredentialInput,
  ): Promise<ILlmCredentialData | null>;
  abstract update(
    id: string,
    input: Partial<ILlmCredentialInput>,
  ): Promise<ILlmCredentialData | null>;
  abstract remove(id: string): Promise<void>;
  abstract checkHealth(id: string): Promise<ILlmHealthCheckResult>;
}
