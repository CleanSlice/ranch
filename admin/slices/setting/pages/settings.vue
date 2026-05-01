<template>
  <div class="flex flex-col gap-6">
    <div>
      <h1 class="text-2xl font-semibold">Settings</h1>
      <p class="text-sm text-muted-foreground">
        Stored as key/value in the database.
      </p>
    </div>

    <div class="grid gap-8 md:grid-cols-[16rem_1fr]">
      <aside>
        <SettingMenu />
      </aside>
      <section class="min-w-0">
        <NuxtPage />
      </section>
    </div>
  </div>
</template>
