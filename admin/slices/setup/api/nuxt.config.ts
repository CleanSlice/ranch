import { fileURLToPath } from 'url';
import { dirname } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineNuxtConfig({
  alias: {
    '#api': currentDir,
  },
  runtimeConfig: {
    public: {
      apiUrl: process.env.NUXT_PUBLIC_API_URL || 'http://localhost:3333',
    },
  },
});
