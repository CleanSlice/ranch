export interface ILlmCredentialData {
  id: string;
  provider: string;
  model: string;
  fallbackModel: string | null;
  label: string | null;
  apiKey: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateLlmCredentialData {
  provider: string;
  model: string;
  apiKey: string;
  fallbackModel?: string | null;
  label?: string | null;
  status?: string;
}

export interface IUpdateLlmCredentialData {
  provider?: string;
  model?: string;
  apiKey?: string;
  fallbackModel?: string | null;
  label?: string | null;
  status?: string;
}
