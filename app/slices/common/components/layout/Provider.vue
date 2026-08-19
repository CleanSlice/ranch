<template>
  <div class="min-h-screen flex flex-col bg-background">
    <header
      class="sticky top-0 z-40 shrink-0 backdrop-blur bg-background/80 border-b"
    >
      <div class="container mx-auto flex items-center h-14 px-4 gap-6">
        <NuxtLink to="/" class="flex items-center gap-2 font-bold text-lg">
          <span
            class="w-7 h-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center"
          >
            <Icon name="tractor" :size="18" />
          </span>
          {{ $t('app_name') }}
        </NuxtLink>

        <nav class="hidden md:flex items-center gap-5 text-sm">
          <NuxtLink
            to="/agents"
            class="text-muted-foreground hover:text-foreground transition-colors"
            active-class="text-foreground font-medium"
          >
            {{ $t('nav.agents') }}
          </NuxtLink>
          <NuxtLink
            v-if="authStore.isAuthenticated"
            to="/chats"
            class="text-muted-foreground hover:text-foreground transition-colors"
            active-class="text-foreground font-medium"
          >
            {{ $t('nav.history') }}
          </NuxtLink>
        </nav>

        <div class="flex-1" />

        <!-- Browser language decides the first render (detectBrowserLanguage);
             this lets the user override it. setLocale writes the same cookie,
             so the choice survives a reload. -->
        <select
          :value="locale"
          :aria-label="$t('locale.label')"
          class="rounded-md border bg-transparent px-1.5 py-1 text-xs uppercase text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          @change="onLocaleChange"
        >
          <option
            v-for="option in locales"
            :key="option.code"
            :value="option.code"
          >
            {{ option.code.toUpperCase() }}
          </option>
        </select>

        <div v-if="authStore.isAuthenticated" class="flex items-center gap-3 text-sm">
          <span class="hidden sm:inline text-muted-foreground" :title="authStore.user?.email ?? ''">
            {{ authStore.user?.name ?? authStore.user?.email }}
          </span>
          <span
            v-if="authStore.role"
            class="hidden sm:inline rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            {{ authStore.role }}
          </span>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground transition-colors"
            @click="onLogout"
          >
            {{ $t('auth.sign_out') }}
          </button>
        </div>
        <div v-else class="flex items-center gap-3 text-sm">
          <NuxtLink to="/login" class="text-muted-foreground hover:text-foreground transition-colors">
            {{ $t('auth.sign_in') }}
          </NuxtLink>
          <NuxtLink
            v-if="registrationEnabled"
            to="/register"
            class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 transition"
          >
            {{ $t('auth.sign_up') }}
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="flex-1 min-h-0 flex flex-col">
      <!-- Single slot with a toggled wrapper class. Splitting this into
           v-if/v-else branches (each with its own <slot/>) tears down and
           recreates the page subtree whenever `isFlush` flips — i.e. on every
           navigation into/out of /agents/:id — which remounts the page and
           re-fires all its useAsyncData requests. One element = no remount. -->
      <div
        :class="
          isFlush
            ? 'flex-1 min-h-0 flex flex-col'
            : 'container mx-auto px-4 py-6 w-full'
        "
      >
        <slot />
      </div>
    </main>

    <footer v-if="!isFlush" class="shrink-0 border-t">
      <div
        class="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <div>{{ $t('footer.note', { year }) }}</div>
        <div class="flex items-center gap-4">
          <NuxtLink to="/agents" class="hover:text-foreground">
            {{ $t('nav.agents') }}
          </NuxtLink>
          <NuxtLink to="/templates" class="hover:text-foreground">
            {{ $t('nav.templates') }}
          </NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const authStore = useAuthStore();
const { locale, locales, setLocale } = useI18n();
const year = new Date().getFullYear();

async function onLocaleChange(event: Event) {
  await setLocale((event.target as HTMLSelectElement).value as typeof locale.value);
}

// Pages that own the full content area (no container padding, no footer).
// Matches /agents/:id (chat-first agent detail) but NOT /agents or /agents/create.
const isFlush = computed(() => {
  const p = route.path;
  return /^\/agents\/[^/]+$/.test(p) && p !== '/agents/create';
});

// Show "Sign up" only when self-service registration is open. Lazy-loaded
// once on first paint — refreshes when admin flips the setting on next nav.
const { enabled: registrationEnabled, refresh: refreshRegistration } =
  useRegistrationEnabled();

if (!authStore.isAuthenticated) {
  await useAsyncData('app-layout-registration-enabled', () => refreshRegistration());
}

async function onLogout() {
  authStore.logout();
  await navigateTo('/');
}
</script>
