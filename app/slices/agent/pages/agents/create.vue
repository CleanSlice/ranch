<script setup lang="ts">
const authStore = useAuthStore();

// Page-level guard: regular User can't create agents (server returns 403,
// but we redirect to the list so the URL doesn't sit broken in the address bar).
if (!authStore.hasRole(UserRoleTypes.Owner, UserRoleTypes.Admin)) {
  await navigateTo('/agents');
}

// A placeholder while the create form is being built: the three stages a new
// agent will go through, as a stepper the visitor can walk. Nothing here
// talks to the API; the copy says so.
const stages = ['template', 'resources', 'deploy'] as const;
const step = ref(0);
function go(i: number) {
  step.value = ((i % stages.length) + stages.length) % stages.length;
}
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col items-center gap-7 px-4 py-14 text-center">
    <span
      class="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-primary"
    >
      <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden="true" />
      {{ $t('create_stub.badge') }}
    </span>

    <h1 class="text-3xl font-semibold tracking-tight">{{ $t('create_stub.title') }}</h1>
    <p class="max-w-lg text-muted-foreground">{{ $t('create_stub.lede') }}</p>

    <section class="w-full rounded-2xl border bg-card p-6 text-left" :aria-label="$t('create_stub.steps_label')">
      <ol class="flex items-center gap-2">
        <li v-for="(stage, i) in stages" :key="stage" class="flex items-center gap-2">
          <button
            type="button"
            class="flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs transition"
            :class="
              i === step
                ? 'border-primary bg-primary text-primary-foreground'
                : i < step
                  ? 'border-primary/40 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
            "
            :aria-current="i === step ? 'step' : undefined"
            :aria-label="$t(`create_stub.${stage}_title`)"
            @click="go(i)"
          >
            {{ i + 1 }}
          </button>
          <span
            v-if="i < stages.length - 1"
            class="h-px w-8 transition-colors"
            :class="i < step ? 'bg-primary/50' : 'bg-border'"
            aria-hidden="true"
          />
        </li>
      </ol>

      <h2 class="mt-5 text-lg font-semibold">{{ $t(`create_stub.${stages[step]}_title`) }}</h2>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">{{ $t(`create_stub.${stages[step]}_body`) }}</p>

      <div class="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          @click="go(step + 1)"
        >
          {{ $t('create_stub.next') }}
        </button>
        <NuxtLink to="/agents" class="text-sm text-muted-foreground transition hover:text-foreground">
          {{ $t('create_stub.back') }}
        </NuxtLink>
      </div>
    </section>

    <p class="font-mono text-xs text-muted-foreground">{{ $t('create_stub.note') }}</p>
  </div>
</template>
