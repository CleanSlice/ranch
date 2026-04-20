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

const templateStore = useTemplateStore();

const { data: templates, pending, refresh } = await useAsyncData(
  'admin-templates',
  () => templateStore.fetchAll(),
);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

async function onRemove(template: ITemplateData) {
  await templateStore.remove(template.id);
  await refresh();
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
            <TableCell>
              <div class="font-medium">{{ template.name }}</div>
              <div class="text-xs text-muted-foreground">{{ template.description }}</div>
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
                <Button size="sm" variant="ghost" class="text-destructive" @click="onRemove(template)">
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      No templates yet.
    </div>
  </div>
</template>
