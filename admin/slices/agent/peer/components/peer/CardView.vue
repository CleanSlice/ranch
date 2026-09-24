<script setup lang="ts">
import type { IAgentCard } from '#peer/stores/peer';
import { cardAddress, cardLegacyVersion } from '#peer/domain';

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

// The interface delegations will dial, not merely the first one listed.
const address = computed(() => cardAddress(props.card));
// Null on a current agent; the version itself on one Ranch talks to in the
// old dialect, which is worth seeing before connecting (CLEAN-114).
const legacyVersion = computed(() => cardLegacyVersion(props.card));

function skillTag(tags: string[]): string | null {
  if (tags.includes('knowledge')) return 'knowledge';
  if (tags.includes('skill')) return 'skill';
  return null;
}
</script>

<template>
  <div v-if="card" :class="compact ? 'space-y-3' : 'space-y-4'">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <p class="font-medium">{{ card.name }}</p>
        <Badge
          v-if="legacyVersion"
          variant="outline"
          title="Ranch talks to this agent in the older A2A dialect. It works, but the protocol carries less: no streaming, and replies arrive whole."
        >
          A2A {{ legacyVersion }}
        </Badge>
      </div>
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
      <!-- A skill-less agent is a valid peer; saying so beats an empty box.
           Just the fact here — the surfaces that embed this view carry the
           what-to-do-about-it guidance (CLEAN-95). -->
      <p v-else class="text-sm text-muted-foreground">
        Nothing advertised — this text is all a delegating agent gets to
        match a question against.
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
