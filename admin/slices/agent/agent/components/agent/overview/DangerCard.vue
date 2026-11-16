<script setup lang="ts">
/**
 * Delete agent (CLEAN-228, User Story 6): its own block at the bottom of
 * Overview, visibly dangerous, saying what deleting does. Pressing the button
 * opens the confirmation the header menu opens too — the page hosts one
 * (`composables/useAgentDelete.ts`). Deleting acts after that confirmation
 * and has nothing to do with the save bar.
 */
import { useOptionalAgentDraft } from '#agent/composables/useAgentDraft'
import { useAgentDeleteRequest } from '#agent/composables/useAgentDelete'

const props = defineProps<{ agentId: string }>()

const agentStore = useAgentStore()
const agent = computed(() => agentStore.byId(props.agentId))

const requestDelete = useAgentDeleteRequest()
const draft = useOptionalAgentDraft()

// Only where no page hosts the dialog: this block opens its own and leaves
// for the list afterwards, as the Edit page used to.
const ownDialogOpen = ref(false)

function onDelete() {
  if (requestDelete) requestDelete()
  else ownDialogOpen.value = true
}

async function onDeletedHere() {
  // Edits to an agent that no longer exists are not something to ask about.
  draft?.discard()
  await navigateTo('/agents')
}
</script>

<template>
  <section
    v-if="agent"
    class="rounded-xl border border-destructive/30 bg-card"
    data-block="danger"
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
      <h2 class="text-[15px] font-semibold text-destructive">Delete agent</h2>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="ml-auto max-w-full min-w-0 shrink border-destructive/35 text-destructive hover:bg-destructive/5 hover:text-destructive"
        :title="`Delete “${agent.name}”`"
        data-delete-agent
        @click="onDelete"
      >
        <span class="min-w-0 truncate">Delete “{{ agent.name }}”</span>
      </Button>
      <p class="basis-full text-[13px] text-muted-foreground">
        Stops the pod, cancels its workflow, deletes scenarios and evaluation
        history, revokes its service tokens. Cannot be undone. What is stored
        for it under
        <code class="font-mono text-xs break-all">agents/{{ agent.id }}/</code>
        — files, skills, secrets, usage — is kept unless you choose to wipe it
        in the confirmation.
      </p>
    </div>

    <AgentDeleteDialog
      v-if="!requestDelete"
      v-model:open="ownDialogOpen"
      :agent-id="agent.id"
      :agent-name="agent.name"
      @deleted="onDeletedHere"
    />
  </section>
</template>
