import { client } from '../data/repositories/api/client.gen';

export const handleApiAuthentication = (token?: string) => {
  client.setConfig({
    headers: { Authorization: token ? `Bearer ${token}` : null },
  });
};
