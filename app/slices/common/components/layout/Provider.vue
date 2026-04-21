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
      </div>
    </header>

    <main class="flex-1 min-h-0 flex flex-col">
      <div v-if="!isDashboard" class="container mx-auto px-4 py-6 w-full">
        <slot />
      </div>
      <div v-else class="flex-1 min-h-0 flex flex-col">
        <slot />
      </div>
    </main>

    <footer class="shrink-0 border-t">
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
const year = new Date().getFullYear();

const isDashboard = computed(() => route.path.startsWith('/chat'));
</script>
