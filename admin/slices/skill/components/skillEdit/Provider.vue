<script setup lang="ts">
import type { ISkillInput } from '#skill/stores/skill';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconArrowLeft, IconExternalLink } from '@tabler/icons-vue';

const props = defineProps<{ id: string }>();

const skillStore = useSkillStore();
const submitting = ref(false);
const errorMessage = ref<string | null>(null);

const { data: skill, pending } = await useAsyncData(
  `admin-skill-${props.id}-edit`,
  () => skillStore.fetchById(props.id),
);

async function onSubmit(values: ISkillInput) {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await skillStore.update(props.id, values);
    await navigateTo('/skills');
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } }; message?: string };
    errorMessage.value = e?.response?.data?.message ?? e?.message ?? 'Save failed';
  } finally {
    submitting.value = false;
  }
}

function onCancel() {
  navigateTo('/skills');
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink
      to="/skills"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft class="size-4" /> Back to skills
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="skill">
      <div>
        <h1 class="text-2xl font-semibold">Edit skill</h1>
        <p class="text-sm text-muted-foreground">
          <code>{{ skill.name }}</code> · {{ skill.title }}
        </p>
      </div>

      <p v-if="errorMessage" class="text-xs text-destructive">{{ errorMessage }}</p>

      <SkillForm
        :initial-values="{
          name: skill.name,
          title: skill.title,
          body: skill.body,
          description: skill.description ?? undefined,
        }"
        :submitting="submitting"
        submit-label="Save changes"
        lock-name
        @submit="onSubmit"
        @cancel="onCancel"
      />

      <Card v-if="skill.files?.length" class="w-full min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Bundled files ({{ skill.files.length }})</CardTitle>
          <CardDescription>
            Sibling files imported from
            <a
              v-if="skill.source"
              :href="skill.source"
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
        <CardContent class="flex flex-col gap-3 min-w-0">
          <details
            v-for="file in skill.files"
            :key="file.path"
            class="rounded-md border bg-muted/20"
          >
            <summary class="flex cursor-pointer items-center justify-between gap-2 p-2 text-xs font-mono">
              <span class="break-all">{{ file.path }}</span>
              <span class="shrink-0 text-muted-foreground">
                {{ file.content.length }} B
              </span>
            </summary>
            <pre
              class="max-h-[400px] overflow-auto whitespace-pre-wrap break-words border-t bg-background p-2 text-[11px] leading-relaxed"
            >{{ file.content }}</pre>
          </details>
        </CardContent>
      </Card>
    </template>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      Skill not found.
    </div>
  </div>
</template>
