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
          Ranch
        </NuxtLink>

        <nav class="hidden md:flex items-center gap-5 text-sm">
          <NuxtLink
            to="/chat"
            class="text-muted-foreground hover:text-foreground transition-colors"
            active-class="text-foreground font-medium"
          >
            Agents
          </NuxtLink>
        </nav>

        <div class="flex-1" />

        <div v-if="authStore.isAuthenticated" class="flex items-center gap-3 text-sm">
          <span class="hidden sm:inline text-muted-foreground" :title="authStore.user?.email ?? ''">
            {{ authStore.user?.name ?? authStore.user?.email }}
          </span>
          <span
            v-for="role in authStore.roles"
            :key="role"
            class="hidden sm:inline rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
          >
            {{ role }}
          </span>
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground transition-colors"
            @click="onLogout"
          >
            Sign out
          </button>
        </div>
        <div v-else class="flex items-center gap-3 text-sm">
          <NuxtLink to="/login" class="text-muted-foreground hover:text-foreground transition-colors">
            Sign in
          </NuxtLink>
          <NuxtLink
            v-if="registrationEnabled"
            to="/register"
            class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 transition"
          >
            Sign up
          </NuxtLink>
        </div>
      </div>
    </header>

    <main class="flex-1 min-h-0 flex flex-col">
      <div v-if="!isFlush" class="container mx-auto px-4 py-6 w-full">
        <slot />
      </div>
      <div v-else class="flex-1 min-h-0 flex flex-col">
        <slot />
      </div>
    </main>

    <footer v-if="!isFlush" class="shrink-0 border-t">
      <div
        class="container mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <div>© {{ year }} Ranch — built on CleanSlice.</div>
        <div class="flex items-center gap-4">
          <NuxtLink to="/agents" class="hover:text-foreground">
            Agents
          </NuxtLink>
          <NuxtLink to="/templates" class="hover:text-foreground">
            Templates
          </NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const authStore = useAuthStore();
const year = new Date().getFullYear();

// Pages that own the full content area (no container padding, no footer).
// Matches:
//   /chat           — agents+chat dashboard
//   /agents/:id     — chat-first agent detail (but NOT /agents or /agents/create)
const isFlush = computed(() => {
  const p = route.path;
  if (p.startsWith('/chat')) return true;
  if (/^\/agents\/[^/]+$/.test(p) && p !== '/agents/create') return true;
  return false;
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
