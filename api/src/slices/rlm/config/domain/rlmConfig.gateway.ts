export interface IRlmModelPair {
  rootCredentialId: string | null;
  subCredentialId: string | null;
}

export abstract class IRlmConfigGateway {
  abstract isEnabled(): Promise<boolean>;
  abstract getModelPair(): Promise<IRlmModelPair>;
  abstract getMaxIterations(): Promise<number>;
  abstract getTimeoutS(): Promise<number>;
}
