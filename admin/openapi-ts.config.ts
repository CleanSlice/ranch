import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  name: 'ApiClient',
  input: '../api/swagger-spec.json',
  output: {
    format: 'prettier',
    lint: 'eslint',
    path: './slices/setup/api/data/repositories/api',
  },
  plugins: [
    {
      name: '@hey-api/client-axios',
      runtimeConfigPath: './slices/setup/api/api.config.ts',
    },
    { enums: 'typescript', name: '@hey-api/typescript' },
    { name: '@hey-api/schemas', type: 'json' },
    { name: '@hey-api/sdk', asClass: true },
  ],
});
