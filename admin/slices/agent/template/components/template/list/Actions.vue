<script setup lang="ts">
import {
  IconDotsVertical,
  IconPencil,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-vue';

/**
 * The kebab on a template card or row (CLEAN-130). The card around it is a
 * link, so the trigger's click is stopped and its default cancelled — that
 * is what keeps the card from opening; the menu itself renders in a portal
 * and never bubbles to the card. The destructive choices are confirmed by
 * the list, not here.
 */
defineProps<{ templateId: string }>();

defineEmits<{ restart: []; remove: [] }>();
</script>

<template>
  <span class="inline-flex shrink-0">
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button
        size="sm"
        variant="ghost"
        class="size-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        @click.prevent.stop
      >
        <span class="sr-only">Template actions</span>
        <IconDotsVertical class="size-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" @click.stop>
      <DropdownMenuItem as-child>
        <NuxtLink :to="`/templates/${templateId}/edit`">
          <IconPencil class="size-4" />
          Edit
        </NuxtLink>
      </DropdownMenuItem>
      <DropdownMenuItem @select="$emit('restart')">
        <IconRefresh class="size-4" />
        Restart all agents
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        class="text-destructive focus:text-destructive"
        @select="$emit('remove')"
      >
        <IconTrash class="size-4" />
        Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  </span>
</template>
