<script setup lang="ts">
import {
  IconBan,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconLink,
  IconLoader2,
  IconRefresh,
  IconShare2,
} from '@tabler/icons-vue';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '#theme/components/ui/dropdown-menu';
import { useShareLink } from '#share/composables/useShareLink';

/**
 * Share as a submenu of the agent header's `…` menu (specs/017, R6).
 *
 * It opens beside the Share row and the menu stays open: every control is a
 * menu row, so the keyboard and the outside-click rules are the menu's own
 * and there is never a second overlay to collide with. Rows that must not
 * close the menu use `@select.prevent` (reka-ui honours the prevented default);
 * only "Open in the app" lets the menu close, because it navigates away.
 *
 * The link is a read-only row, not a field: a text input inside a menu loses
 * its keys to the menu's navigation. Copy link is how the operator takes it.
 */
const props = defineProps<{ agentId: string }>();

const {
  isShared,
  appUrlMissing,
  shareUrl,
  loadingLink,
  linkUnknown,
  sharedSince,
  copied,
  confirming,
  revoked,
  pending,
  error,
  reset,
  loadLink,
  onCopy,
  onShare,
  onConfirm,
  cancelConfirm,
} = useShareLink(() => props.agentId);

// Opening only *reads* the state (see useShareLink.reset).
function onOpenChange(open: boolean) {
  if (open) reset();
}
</script>

<template>
  <DropdownMenuSub @update:open="onOpenChange">
    <DropdownMenuSubTrigger>
      <IconShare2 class="size-4" />
      Share
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent class="w-72">
      <!-- Loading: the first read for this agent is in flight. -->
      <DropdownMenuItem v-if="loadingLink" disabled>
        <IconLoader2 class="size-4 animate-spin" />
        Loading share link…
      </DropdownMenuItem>

      <!-- The read failed: say so and offer it again, rather than guessing. -->
      <template v-else-if="linkUnknown">
        <DropdownMenuItem disabled class="text-destructive">
          Could not load the share link.
        </DropdownMenuItem>
        <DropdownMenuItem
          :disabled="pending"
          @select.prevent="loadLink"
        >
          <IconRefresh class="size-4" />
          Try again
        </DropdownMenuItem>
      </template>

      <!-- Shared: the link, when it started, and what can be done to it. -->
      <template v-else-if="isShared">
        <template v-if="!confirming">
          <DropdownMenuLabel
            v-if="!appUrlMissing"
            class="flex flex-col gap-0.5 font-normal"
          >
            <span class="flex items-center gap-1.5">
              <IconLink class="size-3.5 shrink-0 text-muted-foreground" />
              <span
                class="min-w-0 truncate font-mono text-xs"
                dir="ltr"
                :title="shareUrl"
              >{{ shareUrl }}</span>
            </span>
            <span v-if="sharedSince" class="text-xs text-muted-foreground">
              Shared {{ sharedSince }}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuLabel
            v-else
            class="whitespace-normal font-normal text-xs leading-snug text-amber-900 dark:text-amber-200"
          >
            This agent is shared, but admin can't tell where the app lives from
            this address, so it can't build the link. Copy it from the app, or
            set <code class="font-mono">NUXT_PUBLIC_APP_URL</code> on the admin
            deployment.
          </DropdownMenuLabel>

          <DropdownMenuItem
            v-if="!appUrlMissing"
            :disabled="pending"
            @select.prevent="onCopy"
          >
            <IconCheck v-if="copied" class="size-4" />
            <IconCopy v-else class="size-4" />
            {{ copied ? 'Copied' : 'Copy link' }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="!appUrlMissing" as-child>
            <a :href="shareUrl" target="_blank" rel="noopener">
              <IconExternalLink class="size-4" />
              Open in the app
            </a>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            :disabled="pending"
            @select.prevent="confirming = 'regenerate'"
          >
            <IconRefresh class="size-4" />
            Regenerate
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            :disabled="pending"
            @select.prevent="confirming = 'revoke'"
          >
            <IconBan class="size-4" />
            Revoke
          </DropdownMenuItem>
        </template>

        <!-- Two-step confirm, as rows: the question, then the two answers. -->
        <template v-else>
          <DropdownMenuLabel class="whitespace-normal font-normal text-xs leading-snug">
            {{
              confirming === 'revoke'
                ? 'Revoke this link? Anyone using it will lose access immediately.'
                : 'Replace the link? The current one stops working immediately.'
            }}
          </DropdownMenuLabel>
          <DropdownMenuItem
            variant="destructive"
            :disabled="pending"
            @select.prevent="onConfirm"
          >
            <IconLoader2 v-if="pending" class="size-4 animate-spin" />
            <IconBan v-else-if="confirming === 'revoke'" class="size-4" />
            <IconRefresh v-else class="size-4" />
            {{ confirming === 'revoke' ? 'Revoke link' : 'Replace link' }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="pending"
            @select.prevent="cancelConfirm"
          >
            Cancel
          </DropdownMenuItem>
        </template>
      </template>

      <!-- Not shared: one action, and one line saying why there is nothing
           to copy. After a revoke that line reports the revoke instead. -->
      <template v-else>
        <DropdownMenuLabel class="font-normal text-xs text-muted-foreground">
          {{ revoked ? 'Link revoked.' : 'This agent is not shared.' }}
        </DropdownMenuLabel>
        <DropdownMenuItem
          :disabled="pending"
          @select.prevent="onShare"
        >
          <IconLoader2 v-if="pending" class="size-4 animate-spin" />
          <IconShare2 v-else class="size-4" />
          Share
        </DropdownMenuItem>
      </template>

      <!-- `linkUnknown` renders its own copy of this line above, with a retry. -->
      <DropdownMenuLabel
        v-if="error && !linkUnknown"
        class="font-normal text-xs text-destructive"
      >
        Could not update the share link.
      </DropdownMenuLabel>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
</template>
