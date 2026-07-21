import type { ILlmGateway } from './llm.gateway';
import type {
  ILlmCredentialData,
  ILlmCredentialInput,
  ILlmHealthCheckResult,
} from './llm.types';

/** Domain service for LLM credentials. The store layers list/loading/error. */
export class LlmService {
  constructor(private gateway: ILlmGateway) {}

  findAll(): Promise<ILlmCredentialData[]> {
    return this.gateway.findAll();
  }

  findById(id: string): Promise<ILlmCredentialData | null> {
    return this.gateway.findById(id);
  }

  create(input: ILlmCredentialInput): Promise<ILlmCredentialData | null> {
    return this.gateway.create(input);
  }

  update(
    id: string,
    input: Partial<ILlmCredentialInput>,
  ): Promise<ILlmCredentialData | null> {
    return this.gateway.update(id, input);
  }

  remove(id: string): Promise<void> {
    return this.gateway.remove(id);
  }

  checkHealth(id: string): Promise<ILlmHealthCheckResult> {
    return this.gateway.checkHealth(id);
  }
}
