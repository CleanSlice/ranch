import { client } from '../data/repositories/api/client.gen';

export const handleApiAuthentication = (token?: string) => {
  if (token) {
    client.instance.defaults.headers.common['Authorization'] =
      `Bearer ${token}`;
  } else {
    delete client.instance.defaults.headers.common['Authorization'];
  }
};
