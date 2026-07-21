import { AuthGateway } from '../data/auth.gateway';
import { AuthService } from '../domain/auth.service';

/**
 * Composition root for the auth slice. Provides `$authService`. Must run before
 * the `auth-init` plugin, which calls the store's `hydrate()` → `me()` at setup
 * (see auth-init's `dependsOn`).
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
