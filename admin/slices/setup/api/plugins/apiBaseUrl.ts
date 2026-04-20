import { client } from '../data/repositories/api/client.gen';

export default defineNuxtPlugin({
  enforce: 'pre',
  setup() {
    const config = useRuntimeConfig();
    client.setConfig({ baseURL: config.public.apiUrl as string });
  },
});
