import { AuthGateway } from '../data/auth.gateway';
import { AuthService } from '../domain/auth.service';

/**
 * Composition root for the auth slice. Builds the service graph
 * (service → gateway → mapper) and provides it as `$authService`. Must run
 * before the `auth-init` plugin, which calls the store's `init()` → `me()` at
 * setup time (see auth-init's `dependsOn`).
 */
export default defineNuxtPlugin({
  name: 'auth-di',
  setup() {
    const service = new AuthService(new AuthGateway());
    return {
      provide: {
        authService: service,
      },
    };
  },
});
