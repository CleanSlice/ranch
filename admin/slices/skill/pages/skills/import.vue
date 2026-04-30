<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { IconArrowLeft } from '@tabler/icons-vue';
</script>

<template>
  <div class="flex flex-col gap-6">
    <Button variant="ghost" size="sm" as-child class="w-fit -ml-3 text-muted-foreground">
      <NuxtLink to="/skills">
        <IconArrowLeft class="size-4" /> Back to skills
      </NuxtLink>
    </Button>

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
