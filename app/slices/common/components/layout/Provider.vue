<template>
  <div class="min-h-screen flex flex-col bg-background">
    <header
      class="sticky top-0 z-40 backdrop-blur bg-background/80 border-b"
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
            Chat
          </NuxtLink>
          <NuxtLink
            to="/agents"
            class="text-muted-foreground hover:text-foreground transition-colors"
            active-class="text-foreground font-medium"
          >
            Agents
          </NuxtLink>
          <NuxtLink
            to="/templates"
            class="text-muted-foreground hover:text-foreground transition-colors"
            active-class="text-foreground font-medium"
          >
            Templates
          </NuxtLink>
        </nav>

        <div class="flex-1" />

        <a
          href="https://github.com/Dreamvention/cleanslice"
          target="_blank"
          rel="noopener"
          class="hidden sm:inline-flex text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Docs
        </a>
        <NuxtLink
          to="/chat"
          class="inline-flex items-center rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition"
        >
          Open dashboard
        </NuxtLink>
      </div>
    </header>

    <main class="flex-1 container mx-auto px-4 py-6">
      <slot />
    </main>

    <footer class="border-t mt-auto">
      <div
        class="container mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground"
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
const year = new Date().getFullYear();
</script>
