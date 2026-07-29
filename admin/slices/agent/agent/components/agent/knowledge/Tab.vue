<script setup lang="ts">
import type { IAgentData } from '#agent/domain';

const props = defineProps<{ agent: IAgentData }>();

const agentRef = computed(() => props.agent);
const { effective, resolved, pending } = useAgentKnowledges(
  props.agent.id,
  agentRef,
);
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-start justify-between gap-3">
        <div>
          <CardTitle>Knowledge bases</CardTitle>
          <CardDescription>
            Bases this agent can query via the <code>query_knowledge</code> tool.
            <span v-if="effective.source === 'agent-override'">
              Source: per-agent override.
            </span>
            <span v-else-if="effective.source === 'from-template'">
              Source: inherited from template.
            </span>
            <span v-else>No bases bound.</span>
            Manage bindings in the
            <NuxtLink :to="`/agents/${agent.id}/edit`" class="underline">edit</NuxtLink>
            page.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" as-child>
          <NuxtLink to="/knowledges">Manage</NuxtLink>
        </Button>
      </div>
    </CardHeader>
    <CardContent>
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
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead class="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="k in resolved"
              :key="k.id"
              class="cursor-pointer"
              @click="navigateTo(`/knowledges/${k.id}/edit`)"
            >
              <TableCell class="font-medium">{{ k.name }}</TableCell>
              <TableCell class="max-w-md truncate text-muted-foreground">
                {{ k.description || '-' }}
              </TableCell>
              <TableCell>
                <KnowledgeIndexStatusBadge :status="k.indexStatus" />
              </TableCell>
              <TableCell class="text-muted-foreground">
                {{ formatDateTime(k.updatedAt) }}
              </TableCell>
              <TableCell @click.stop>
                <div class="flex justify-end gap-2">
                  <Button size="sm" variant="outline" as-child>
                    <NuxtLink :to="`/knowledges/${k.id}/edit`">Open</NuxtLink>
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
        No knowledge bases bound. Bind in the
        <NuxtLink :to="`/agents/${agent.id}/edit`" class="underline">edit</NuxtLink>
        page.
      </div>
    </CardContent>
  </Card>
</template>
