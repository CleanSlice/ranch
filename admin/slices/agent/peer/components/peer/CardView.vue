<script setup lang="ts">
import type { IAgentCard } from '#peer/stores/peer';

/**
 * An agent card, rendered as the agent on the other side reads it (CLEAN-74).
 *
 * Deliberately not prettified into a summary: this is the text a delegating
 * model will reason over, so an operator judging whether a peer is worth
 * connecting — or why the wrong peer keeps getting picked — has to see the
 * same words it does.
 */
const props = defineProps<{
  card: IAgentCard | null;
  /** Inside the picker preview: drop the address line and tighten spacing. */
  compact?: boolean;
}>();

const skills = computed(() => props.card?.skills ?? []);

const address = computed(
  () => props.card?.supportedInterfaces?.[0]?.url ?? null,
);

function skillTag(tags: string[]): string | null {
  if (tags.includes('knowledge')) return 'knowledge';
  if (tags.includes('skill')) return 'skill';
  return null;
}
</script>

<template>
  <div v-if="card" :class="compact ? 'space-y-3' : 'space-y-4'">
    <div>
      <p class="font-medium">{{ card.name }}</p>
      <p class="text-sm text-muted-foreground">{{ card.description }}</p>
    </div>

    <div>
      <p class="mb-1.5 text-xs font-medium uppercase text-muted-foreground">
        Can do
      </p>
      <ul v-if="skills.length" class="flex flex-wrap gap-1.5">
        <li v-for="skill in skills" :key="skill.id">
          <Badge variant="outline" :title="skill.description">
            {{ skill.name }}
            <span
              v-if="skillTag(skill.tags)"
              class="ml-1 text-muted-foreground"
            >
              · {{ skillTag(skill.tags) }}
            </span>
          </Badge>
        </li>
      </ul>
      <!-- A skill-less agent is a valid peer; saying so beats an empty box,
           because "nothing advertised" is exactly what a caller needs to know
           before wondering why it is never chosen. -->
      <p v-else class="text-sm text-muted-foreground">
        Nothing advertised. Another agent has no way to tell when to ask this
        one — give it template skills or a knowledge base.
      </p>
    </div>

    <div v-if="!compact && address">
      <p class="mb-1 text-xs font-medium uppercase text-muted-foreground">
        Address
      </p>
      <p class="break-all font-mono text-xs text-muted-foreground">
        {{ address }}
      </p>
    </div>
  </div>

  <p v-else class="text-sm text-muted-foreground">No card to show.</p>
</template>
