/**
 * Factory that returns a memoized getter for a Nuxt-provided service.
 *
 * Usage (at module scope, above `defineStore`):
 *   const getService = createServiceGetter<ChatService>('$chatService');
 *   // then inside the store: `getService().list()`
 *
 * Why module-scope instead of Pinia state:
 *   Class instances can't be serialized during SSR hydration, so they must live
 *   outside Pinia state. The closure gives request-isolated lazy resolution
 *   without touching state.
 *
 * Why markRaw:
 *   Prevents Vue from making the service deeply reactive — services hold their
 *   own state (SDK clients, mappers) that should not be tracked.
 */
export function createServiceGetter<T extends object>(
  injectionKey: string,
): () => T {
  let cached: T | undefined;
  return (): T => {
    if (cached) return cached;
    const app = useNuxtApp() as unknown as Record<string, unknown>;
    const service = app[injectionKey] as T | undefined;
    if (!service) {
      throw new Error(
        `createServiceGetter: '${injectionKey}' is not provided. ` +
          `Ensure the DI plugin runs before this getter is called.`,
      );
    }
    cached = markRaw(service);
    return cached;
  };
}
