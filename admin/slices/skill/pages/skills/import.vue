<template>
  <div class="flex flex-col gap-6">
    <PageBreadcrumbs :items="[{ label: 'Skills', to: '/skills' }, { label: 'Import from GitHub' }]" />

    <div>
      <h1 class="text-2xl font-semibold">Import skill from GitHub</h1>
      <p class="text-sm text-muted-foreground">
        Import a <code>SKILL.md</code> into your skill library. Requires
        <code>integrations/github_pat</code> in
        <NuxtLink to="/settings" class="underline">Settings</NuxtLink> with
        <code>read:packages</code> + <code>public_repo</code> scope.
      </p>
    </div>

    <div class="grid gap-8 md:grid-cols-[16rem_1fr]">
      <aside>
        <SkillImportMenu />
      </aside>
      <section class="min-w-0">
        <NuxtPage />
      </section>
    </div>
  </div>
</template>
