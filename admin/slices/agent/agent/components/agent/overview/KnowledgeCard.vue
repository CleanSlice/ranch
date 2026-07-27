<script setup lang="ts">
import type { IKnowledge } from '#reins/stores/knowledge';

defineProps<{
  source: 'agent-override' | 'from-template' | 'none';
  knowledges: IKnowledge[];
  pending: boolean;
}>();
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Knowledge bases</CardTitle>
      <CardDescription>
        Bases this agent can query via the query_knowledge tool.
        <span v-if="source === 'agent-override'">Source: per-agent override.</span>
        <span v-else-if="source === 'from-template'">Source: inherited from template.</span>
        <span v-else>No bases bound.</span>
      </CardDescription>
    </CardHeader>
    <CardContent>
      <div v-if="pending" class="flex flex-wrap gap-2">
        <Skeleton class="h-6 w-24" />
        <Skeleton class="h-6 w-32" />
        <Skeleton class="h-6 w-20" />
      </div>
      <ul v-else-if="knowledges.length" class="flex flex-wrap gap-2">
        <li v-for="k in knowledges" :key="k.id">
          <Badge variant="outline">{{ k.name }}</Badge>
        </li>
      </ul>
      <p v-else class="text-sm text-muted-foreground">None bound.</p>
    </CardContent>
  </Card>
</template>
