<script setup lang="ts">
import type { ISkillData } from '#skill/stores/skill';
import { IconExternalLink } from '@tabler/icons-vue';

defineProps<{
  files: NonNullable<ISkillData['files']>;
  source: string | null;
}>();
</script>

<template>
  <Card class="w-full min-w-0 overflow-hidden">
    <CardHeader>
      <CardTitle>Bundled files ({{ files.length }})</CardTitle>
      <CardDescription>
        Sibling files imported from
        <a
          v-if="source"
          :href="source"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 underline"
        >
          source <IconExternalLink class="size-3.5" />
        </a>
        <span v-else>the original folder</span>.
        Mounted alongside <code>SKILL.md</code> at runtime.
      </CardDescription>
    </CardHeader>
    <CardContent class="flex min-w-0 flex-col gap-3">
      <details
        v-for="file in files"
        :key="file.path"
        class="rounded-md border bg-muted/20"
      >
        <summary class="flex cursor-pointer items-center justify-between gap-2 p-2 font-mono text-xs">
          <span class="break-all">{{ file.path }}</span>
          <span class="shrink-0 text-muted-foreground">
            {{ file.content.length }} B
          </span>
        </summary>
        <pre
          class="max-h-100 overflow-auto whitespace-pre-wrap wrap-break-word border-t bg-background p-2 text-[11px] leading-relaxed"
        >{{ file.content }}</pre>
      </details>
    </CardContent>
  </Card>
</template>
