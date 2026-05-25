import { client } from '../data/repositories/api/client.gen';

export default defineNuxtPlugin({
  name: 'api-base-url',
  setup() {
    const runtime = useRuntimeConfig();
    const apiUrl = runtime.public.apiUrl;
    if (apiUrl) client.setConfig({ baseURL: apiUrl });
  },
});
