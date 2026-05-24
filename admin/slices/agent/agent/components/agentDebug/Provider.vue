<script setup lang="ts">
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card'
import { Checkbox } from '#theme/components/ui/checkbox'

// Controlled, non-saving checkbox. The host page (agentEdit) holds the
// pending value and persists it as part of "Save changes" — toggling here
// only updates that pending value.
defineProps<{
  debugEnabled: boolean
  // true when the pending value differs from what's saved on the server
  dirty?: boolean
}>()

const emit = defineEmits<{
  'update:debugEnabled': [value: boolean]
}>()

function onToggle(next: boolean | 'indeterminate'): void {
  emit('update:debugEnabled', next === true)
}
</script>

<template>
  <Card>
    <CardHeader>
      <CardTitle>Diagnostics</CardTitle>
      <CardDescription>
        Debug mode for troubleshooting. Applied when you click
        <span class="font-medium">Save changes</span>: the live prompt-debug
        event stream flips on save, verbose pod logs
        (<code>LOG_LEVEL=debug</code>, full error traces) apply on the next
        agent restart.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <label class="flex items-start gap-3 text-sm">
        <Checkbox
          :model-value="debugEnabled"
          @update:model-value="onToggle"
        />
        <span>
          <span class="font-medium">Debug mode</span>
          <span class="block text-xs text-muted-foreground">
            Emits full error traces and the prompt-debug event stream.
            Leave off in normal operation.
          </span>
        </span>
      </label>
      <p v-if="dirty" class="mt-2 text-xs text-muted-foreground">
        Unsaved — applies when you click “Save changes”.
      </p>
    </CardContent>
  </Card>
</template>
