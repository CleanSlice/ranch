import {
  ILlmCredentialData,
  ICreateLlmCredentialData,
  IUpdateLlmCredentialData,
} from './llm.types';

export abstract class ILlmGateway {
  abstract findAll(): Promise<ILlmCredentialData[]>;
  abstract findActive(): Promise<ILlmCredentialData[]>;
  abstract findById(id: string): Promise<ILlmCredentialData | null>;
  abstract create(data: ICreateLlmCredentialData): Promise<ILlmCredentialData>;
  abstract update(
    id: string,
    data: IUpdateLlmCredentialData,
  ): Promise<ILlmCredentialData>;
  abstract delete(id: string): Promise<void>;
}
