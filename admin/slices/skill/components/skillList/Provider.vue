<script setup lang="ts">
import type { ISkillData } from '#skill/stores/skill';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';

const skillStore = useSkillStore();

const { data: items, pending, refresh } = await useAsyncData(
  'admin-skills',
  () => skillStore.fetchAll(),
);

const pendingRemoval = ref<ISkillData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});

async function onRemove() {
  const item = pendingRemoval.value;
  if (!item) return;
  pendingRemoval.value = null;
  await skillStore.remove(item.id);
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Skills</h1>
        <p class="text-sm text-muted-foreground">
          Markdown skills that get mounted into agents under
          <code>.agent/skills/&lt;name&gt;/</code>. Attach them to templates to
          ship with every agent of that template.
        </p>
      </div>
      <div class="flex gap-2">
        <Button variant="outline" as-child>
          <NuxtLink to="/skills/import">Import from GitHub</NuxtLink>
        </Button>
        <Button as-child>
          <NuxtLink to="/skills/create">New skill</NuxtLink>
        </Button>
      </div>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else-if="items?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Files</TableHead>
            <TableHead>Description</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in items"
            :key="item.id"
            class="cursor-pointer"
            @click="navigateTo(`/skills/${item.id}/edit`)"
          >
            <TableCell>
              <code class="text-xs">{{ item.name }}</code>
            </TableCell>
            <TableCell class="font-medium">{{ item.title }}</TableCell>
            <TableCell>
              <Badge v-if="item.files?.length" variant="outline">
                +{{ item.files.length }}
              </Badge>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="text-muted-foreground">
              {{ item.description ?? '—' }}
            </TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/skills/${item.id}/edit`">Edit</NuxtLink>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  @click="pendingRemoval = item"
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div
      v-else
      class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
    >
      No skills yet. Add one to make it available to your templates.
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete skill"
      :description="pendingRemoval ? `Permanently delete skill “${pendingRemoval.title}” (${pendingRemoval.name})? Templates referencing it will keep their reference but lose the content on next agent restart.` : ''"
      confirm-label="Delete skill"
      @confirm="onRemove"
    />
  </div>
</template>
