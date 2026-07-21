import { UserGateway } from '../data/user.gateway';
import { UserService } from '../domain/user.service';

/**
 * Composition root for the user slice. Provides `$userService`.
 */
export default defineNuxtPlugin({
  name: 'user-di',
  setup() {
    const service = new UserService(new UserGateway());
    return {
      provide: {
        userService: service,
      },
    };
  },
});
