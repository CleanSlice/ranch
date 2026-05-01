<template>
  <div class="min-h-screen bg-background text-foreground">
    <div class="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <!-- Marketing / branding panel — hidden on small screens, full bleed on lg+ -->
      <aside
        class="relative hidden lg:flex flex-col justify-between overflow-hidden border-r p-12 bg-linear-to-br from-primary/15 via-background to-background"
      >
        <div
          class="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          class="pointer-events-none absolute bottom-0 right-0 h-80 w-80 rounded-full bg-primary/10 blur-3xl"
        />

        <NuxtLink
          to="/"
          class="relative inline-flex items-center gap-2 font-bold text-lg w-fit"
        >
          <span
            class="w-9 h-9 rounded-md bg-primary text-primary-foreground flex items-center justify-center shadow-sm"
          >
            <Icon name="tractor" :size="20" />
          </span>
          Ranch
        </NuxtLink>

        <div class="relative space-y-6">
          <div
            class="inline-flex items-center gap-2 rounded-full border bg-background/60 backdrop-blur px-3 py-1 text-xs text-muted-foreground"
          >
            <span class="w-2 h-2 rounded-full bg-green-500" />
            Live on Kubernetes
          </div>

          <h2 class="text-3xl font-bold tracking-tight leading-tight">
            Deploy AI agents.<br />
            <span class="text-primary">Talk to them in real time.</span>
          </h2>

          <p class="text-sm text-muted-foreground max-w-md leading-relaxed">
            Ranch spins up containerized AI workers on a managed cluster
            and gives you a streaming chat to drive them. No DevOps required.
          </p>

          <ul class="space-y-3 text-sm text-muted-foreground">
            <li class="flex items-start gap-3">
              <Icon
                name="check"
                :size="16"
                class="mt-0.5 text-primary shrink-0"
              />
              <span>One-click agent deploy on Argo Workflows</span>
            </li>
            <li class="flex items-start gap-3">
              <Icon
                name="check"
                :size="16"
                class="mt-0.5 text-primary shrink-0"
              />
              <span>Token-by-token streaming chat over WebSocket</span>
            </li>
            <li class="flex items-start gap-3">
              <Icon
                name="check"
                :size="16"
                class="mt-0.5 text-primary shrink-0"
              />
              <span>Persistent agent state synced to S3</span>
            </li>
          </ul>
        </div>

        <p class="relative text-xs text-muted-foreground/70">
          Built on CleanSlice · {{ year }}
        </p>
      </aside>

      <!-- Form panel -->
      <main class="flex flex-col">
        <header
          class="flex items-center justify-between px-6 py-5 border-b lg:border-b-0"
        >
          <NuxtLink
            to="/"
            class="lg:hidden inline-flex items-center gap-2 font-semibold text-sm"
          >
            <span
              class="w-7 h-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center"
            >
              <Icon name="tractor" :size="16" />
            </span>
            Ranch
          </NuxtLink>
          <NuxtLink
            to="/"
            class="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <Icon name="arrow-left" :size="14" /> Back to landing
          </NuxtLink>
        </header>

        <div class="flex-1 flex items-center justify-center px-6 py-10 sm:py-14">
          <div class="w-full max-w-sm">
            <slot />
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const year = new Date().getFullYear();
</script>
