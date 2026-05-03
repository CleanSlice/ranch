<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card';
import { IconArrowLeft } from '@tabler/icons-vue';
import { FlaskConical } from 'lucide-vue-next';

const props = defineProps<{ id: string }>();
const templateStore = useTemplateStore();

const { data: template, pending, refresh } = await useAsyncData(
  `admin-template-${props.id}`,
  () => templateStore.fetchById(props.id),
);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

type SectionId = 'blueprint' | 'skills' | 'mcps' | 'files';

const sections: { id: SectionId; title: string; description: string }[] = [
  { id: 'blueprint', title: 'Blueprint', description: 'Image and resource defaults.' },
  { id: 'skills', title: 'Skills', description: 'Attach skills available to this template.' },
  { id: 'mcps', title: 'MCP servers', description: 'Tool servers agents inherit from this template.' },
  { id: 'files', title: 'Files', description: 'The .agent folder uploaded to S3.' },
];

const active = ref<SectionId>('blueprint');

const confirmRemoveOpen = ref(false);

async function onRemove() {
  if (!template.value) return;
  await templateStore.remove(template.value.id);
  await navigateTo('/templates');
}

async function onSkillsSaved() {
  await refresh();
}

async function onMcpsSaved() {
  await refresh();
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <NuxtLink to="/templates" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <IconArrowLeft class="size-4" /> Back to templates
    </NuxtLink>

    <div v-if="pending" class="text-sm text-muted-foreground">Loading…</div>

    <template v-else-if="template">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold">{{ template.name }}</h1>
          <p class="text-sm text-muted-foreground">{{ template.description }}</p>
        </div>
        <div class="flex gap-2">
          <Button variant="outline" as-child>
            <NuxtLink :to="`/templates/${template.id}/paddock`">
              <FlaskConical class="size-4" />
              Paddock
            </NuxtLink>
          </Button>
          <Button variant="outline" as-child>
            <NuxtLink :to="`/templates/${template.id}/edit`">Edit</NuxtLink>
          </Button>
          <Button variant="ghost" class="text-destructive" @click="confirmRemoveOpen = true">Delete</Button>
        </div>
      </div>

      <ConfirmDialog
        v-model:open="confirmRemoveOpen"
        title="Delete template"
        :description="`Permanently delete template “${template.name}”? Existing agents using it will keep running, but you can no longer create new ones from it.`"
        confirm-label="Delete template"
        @confirm="onRemove"
      />

      <div class="grid gap-8 md:grid-cols-[16rem_1fr]">
        <aside>
          <nav class="flex flex-col gap-1">
            <button
              v-for="section in sections"
              :key="section.id"
              type="button"
              class="group rounded-md border border-transparent px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              :class="active === section.id ? 'border-border bg-muted' : ''"
              @click="active = section.id"
            >
              <span class="block font-medium">{{ section.title }}</span>
              <span class="block text-xs text-muted-foreground">
                {{ section.description }}
              </span>
            </button>
          </nav>
        </aside>

        <section class="min-w-0">
          <Card v-if="active === 'blueprint'">
            <CardHeader>
              <CardTitle>Blueprint</CardTitle>
              <CardDescription>Defaults applied when spawning an agent from this template.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div class="sm:col-span-2">
                  <dt class="text-xs text-muted-foreground">Image</dt>
                  <dd class="mt-1">
                    <code class="text-sm">{{ template.image }}</code>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Default CPU</dt>
                  <dd class="mt-1">
                    <Badge variant="outline">{{ template.defaultResources.cpu }}</Badge>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Default memory</dt>
                  <dd class="mt-1">
                    <Badge variant="outline">{{ template.defaultResources.memory }}</Badge>
                  </dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Created</dt>
                  <dd class="mt-1 text-sm">{{ formatDate(template.createdAt) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">Last updated</dt>
                  <dd class="mt-1 text-sm">{{ formatDate(template.updatedAt) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted-foreground">ID</dt>
                  <dd class="mt-1 text-sm text-muted-foreground">{{ template.id }}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card v-else-if="active === 'skills'">
            <CardHeader>
              <CardTitle>Skills</CardTitle>
              <CardDescription>
                Pick which skills this template carries. Saved as a full set —
                unchecked skills are detached. Manage skill content in
                <NuxtLink to="/skills" class="underline">Skills</NuxtLink>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateSkillsProvider
                :template-id="template.id"
                :initial-skill-ids="template.skillIds"
                @saved="onSkillsSaved"
              />
            </CardContent>
          </Card>

          <Card v-else-if="active === 'mcps'">
            <CardHeader>
              <CardTitle>MCP servers</CardTitle>
              <CardDescription>
                Pick which MCP servers agents created from this template should connect to.
                Saved as a full set — unchecked servers are detached. Register new servers in
                <NuxtLink to="/mcps" class="underline">MCP servers</NuxtLink>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateMcpsProvider
                :template-id="template.id"
                :initial-mcp-server-ids="template.mcpServerIds"
                @saved="onMcpsSaved"
              />
            </CardContent>
          </Card>

          <Card v-else-if="active === 'files'">
            <CardHeader>
              <CardTitle>Files</CardTitle>
              <CardDescription>
                Upload a .agent folder to populate this template, then edit individual
                files in the browser.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TemplateFileProvider :id="template.id" />
            </CardContent>
          </Card>
        </section>
      </div>
    </template>

    <div v-else class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
      Template not found.
    </div>
  </div>
</template>
