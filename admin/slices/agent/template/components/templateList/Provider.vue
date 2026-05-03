<script setup lang="ts">
import type { ITemplateData } from '#template/stores/template';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#theme/components/ui/dropdown-menu';
import { IconDotsVertical, IconTrash } from '@tabler/icons-vue';

const templateStore = useTemplateStore();
const rancherStore = useRancherStore();

const { data: templates, pending, refresh } = await useAsyncData(
  'admin-templates',
  () => templateStore.fetchAll(),
);

const { data: rancherStatus, refresh: refreshRancher } = await useAsyncData(
  'admin-rancher-status',
  () => rancherStore.fetchStatus(),
);

const ensuringRancher = ref(false);
const ensureError = ref<string | null>(null);

async function onEnsureRancher() {
  ensuringRancher.value = true;
  ensureError.value = null;
  try {
    await rancherStore.ensureTemplate();
    await Promise.all([refresh(), refreshRancher()]);
  } catch (err: unknown) {
    ensureError.value = err instanceof Error ? err.message : 'Failed to create Rancher template.';
  } finally {
    ensuringRancher.value = false;
  }
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

const pendingRemoval = ref<ITemplateData | null>(null);
const confirmRemoveOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (v: boolean) => {
    if (!v) pendingRemoval.value = null;
  },
});
const removeError = ref<string | null>(null);

async function onRemove() {
  const template = pendingRemoval.value;
  if (!template) return;
  pendingRemoval.value = null;
  removeError.value = null;
  try {
    await templateStore.remove(template.id);
    await refresh();
  } catch (err: unknown) {
    removeError.value = err instanceof Error ? err.message : 'Failed to delete template.';
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold">Templates</h1>
        <p class="text-sm text-muted-foreground">Agent blueprints used when spawning runtime instances.</p>
      </div>
      <Button as-child>
        <NuxtLink to="/templates/create">New template</NuxtLink>
      </Button>
    </div>

    <div
      v-if="removeError"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      {{ removeError }}
    </div>

    <div
      v-if="rancherStatus && !rancherStatus.template"
      class="flex items-center justify-between gap-4 rounded-md border border-primary/30 bg-primary/5 px-4 py-3"
    >
      <div class="flex flex-col gap-1">
        <p class="text-sm font-medium">Rancher template is missing</p>
        <p class="text-xs text-muted-foreground">
          The Rancher template is required to spawn the Ranch admin agent. Create it with the recommended defaults.
        </p>
        <p v-if="ensureError" class="text-xs text-destructive">{{ ensureError }}</p>
      </div>
      <Button size="sm" :disabled="ensuringRancher" @click="onEnsureRancher">
        {{ ensuringRancher ? 'Creating…' : 'Create Rancher template' }}
      </Button>
    </div>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading templates…</div>

    <div v-else-if="templates?.length" class="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>Resources</TableHead>
            <TableHead>Created</TableHead>
            <TableHead class="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="template in templates"
            :key="template.id"
            class="cursor-pointer"
            @click="navigateTo(`/templates/${template.id}`)"
          >
            <TableCell class="max-w-sm">
              <div class="font-medium">{{ template.name }}</div>
              <div class="text-xs text-muted-foreground line-clamp-2 wrap-break-word">{{ template.description }}</div>
            </TableCell>
            <TableCell>
              <code class="text-xs text-muted-foreground">{{ template.image }}</code>
            </TableCell>
            <TableCell>
              <div class="flex gap-1">
                <Badge variant="outline">{{ template.defaultResources.cpu }} CPU</Badge>
                <Badge variant="outline">{{ template.defaultResources.memory }}</Badge>
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(template.createdAt) }}</TableCell>
            <TableCell @click.stop>
              <div class="flex justify-end gap-2">
                <Button size="sm" variant="outline" as-child>
                  <NuxtLink :to="`/templates/${template.id}/edit`">Edit</NuxtLink>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button size="sm" variant="ghost" class="size-8 p-0">
                      <span class="sr-only">Open menu</span>
                      <IconDotsVertical class="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      class="text-destructive focus:text-destructive"
                      @select="pendingRemoval = template"
                    >
                      <IconTrash class="size-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No templates yet.
    </div>

    <ConfirmDialog
      v-model:open="confirmRemoveOpen"
      title="Delete template"
      :description="pendingRemoval ? `Permanently delete template “${pendingRemoval.name}”? Existing agents using it will keep running, but you can no longer create new ones from it.` : ''"
      confirm-label="Delete template"
      @confirm="onRemove"
    />
  </div>
</template>
