import { client } from '../data/repositories/api/client.gen';

export default defineNuxtPlugin(() => {
  const runtime = useRuntimeConfig();
  const apiUrl = runtime.public.apiUrl || 'http://localhost:3333';
  client.setConfig({ baseURL: apiUrl });
});
