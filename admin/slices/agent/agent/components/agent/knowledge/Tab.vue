<script setup lang="ts">
import type { IAgentData } from '#agent/domain';

const props = defineProps<{ agent: IAgentData }>();

const agentStore = useAgentStore();

const localAgent = ref<IAgentData>(props.agent);
watch(
  () => props.agent,
  (a) => {
    localAgent.value = a;
  },
);

const { effective, resolved, missing, knowledges, pending } =
  useAgentKnowledges(props.agent.id, localAgent);

const editing = ref(false);
const draftIds = ref<string[]>([]);
const saving = ref(false);
const saveError = ref<string | null>(null);

function startEdit(): void {
  draftIds.value = [...localAgent.value.knowledgeIds];
  editing.value = true;
}

async function save(): Promise<void> {
  saving.value = true;
  saveError.value = null;
  try {
    const updated = await agentStore.update(props.agent.id, {
      knowledgeIds: [...draftIds.value],
    });
    if (updated) localAgent.value = updated;
    editing.value = false;
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

function unbindMissing(id: string): void {
  draftIds.value = localAgent.value.knowledgeIds.filter((x) => x !== id);
  void save();
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Knowledge bases</CardTitle>
          <CardDescription>
            Bases this agent can query via the <code>query_knowledge</code> tool
            — the only thing that decides what it can reach.
            <span v-if="effective.source === 'agent-override'">
              Source: per-agent override.
            </span>
            <span v-else-if="effective.source === 'from-template'">
              Source: inherited from the template default — binding a base here
              switches this agent to its own list.
            </span>
            <span v-else>No bases bound.</span>
          </CardDescription>
        </div>
        <div class="flex gap-2">
          <Button
            v-if="!editing"
            variant="outline"
            size="sm"
            @click="startEdit"
          >
            Edit bindings
          </Button>
          <Button variant="ghost" size="sm" as-child>
            <NuxtLink to="/knowledges">Manage bases</NuxtLink>
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent class="flex flex-col gap-4">
      <div
        v-for="id in missing"
        :key="id"
        class="flex items-center justify-between gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700"
      >
        <span>
          Bound base <code class="font-mono text-xs">{{ id }}</code> no longer
          exists — the agent silently reads less than this list suggests.
        </span>
        <Button
          v-if="effective.source === 'agent-override'"
          size="sm"
          variant="outline"
          :disabled="saving"
          @click="unbindMissing(id)"
        >
          Remove binding
        </Button>
        <span v-else class="text-xs">
          Inherited from the template — fix it there.
        </span>
      </div>

      <div v-if="editing" class="flex flex-col gap-3">
        <AgentKnowledgeBindingPicker
          v-model="draftIds"
          :knowledges="knowledges ?? []"
        />
        <p class="text-xs text-muted-foreground">
          An empty list falls back to the template default.
        </p>
        <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>
        <div class="flex gap-2">
          <Button size="sm" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save bindings' }}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            :disabled="saving"
            @click="editing = false"
          >
            Cancel
          </Button>
        </div>
      </div>

      <template v-else>
        <div v-if="pending" class="space-y-2">
          <Skeleton class="h-9 w-full" />
          <Skeleton class="h-9 w-full" />
          <Skeleton class="h-9 w-full" />
        </div>
        <div v-else-if="resolved.length" class="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Status</TableHead>
                <TableHead class="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                v-for="k in resolved"
                :key="k.id"
                class="cursor-pointer"
                @click="navigateTo(`/knowledges/${k.id}`)"
              >
                <TableCell class="font-medium">{{ k.name }}</TableCell>
                <TableCell class="max-w-md truncate text-muted-foreground">
                  {{ k.description || '-' }}
                </TableCell>
                <TableCell class="text-muted-foreground">
                  {{ k.sourcesCount ?? k.sources?.length ?? 0 }}
                </TableCell>
                <TableCell>
                  <KnowledgeIndexStatusBadge :status="k.indexStatus" />
                </TableCell>
                <TableCell @click.stop>
                  <div class="flex justify-end gap-2">
                    <Button size="sm" variant="outline" as-child>
                      <NuxtLink :to="`/knowledges/${k.id}`">Open</NuxtLink>
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
          No knowledge bases bound — press “Edit bindings” to choose what this
          agent reads.
        </div>
      </template>
    </CardContent>
  </Card>
</template>
