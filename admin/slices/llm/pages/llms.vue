<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">LLMs</h1>
      <p class="text-sm text-muted-foreground">
        Credentials assigned to agents and their token usage.
      </p>
    </div>

    <div class="grid gap-8 md:grid-cols-[16rem_1fr]">
      <aside>
        <LlmMenu />
      </aside>
      <section class="min-w-0">
        <NuxtPage />
      </section>
    </div>
  </div>
</template>
