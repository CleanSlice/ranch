export interface ILlmCredentialData {
  id: string;
  provider: string;
  model: string;
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
  label?: string | null;
  status?: string;
}

export interface IUpdateLlmCredentialData {
  provider?: string;
  model?: string;
  apiKey?: string;
  label?: string | null;
  status?: string;
}
