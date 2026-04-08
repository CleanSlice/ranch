import type { CreateClientConfig } from './data/repositories/api/client.gen';

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseURL: process.env.API_URL ?? 'http://localhost:3000',
});
