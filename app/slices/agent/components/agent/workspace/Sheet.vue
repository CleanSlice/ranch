<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import type { IBridleConversation } from '#bridle/domain';
import { agentInitials, agentStatusMeta } from '#agent/utils/agentStatus';
import { relativeTime } from '#agent/utils/relativeTime';

/**
 * The character sheet: who the open agent is and what can be done to it,
 * above its chat. Folds to one line so the chat gets the height back; the
 * fold is remembered per browser.
 */
const props = defineProps<{
  agent: IAgentData | null | undefined;
  pending: boolean;
  canManage: boolean;
}>();

const SHEET_KEY = 'agent:sheetOpen';

const open = ref(true);
onMounted(() => {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(SHEET_KEY);
  } catch {
    // Private mode — the default stands.
  }
  if (saved === '1') open.value = true;
  else if (saved === '0') open.value = false;
  // No preference yet: a phone starts folded, the chat needs every row.
  else if (window.matchMedia('(max-width: 1023px)').matches) open.value = false;
});
function toggle() {
  open.value = !open.value;
  try {
    window.localStorage.setItem(SHEET_KEY, open.value ? '1' : '0');
  } catch {
    // Losing the memory costs one click next time.
  }
}

const agentRef = computed(() => props.agent);
const controls = useAgentControls(agentRef);

const meta = computed(() => agentStatusMeta(props.agent?.status));
const initials = computed(() => agentInitials(props.agent?.name, props.agent?.id ?? '?'));

const conversation = computed<IBridleConversation | null>(() =>
  props.agent ? { key: props.agent.id, agentId: props.agent.id } : null,
);

// Dates go through the console's format module so they follow the active
// language the same way every other date in the app does (docs/i18n.md).
const format = useFormat();
const created = computed(() => {
  const iso = props.agent?.createdAt;
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return format.date(iso);
});
const updated = computed(() => relativeTime(props.agent?.updatedAt));

const failedKey = computed(() => {
  switch (controls.failed.value?.action) {
    case 'restart':
      return 'chat.restart_failed';
    case 'stop':
      return 'sheet.stop_failed';
    case 'start':
      return 'sheet.start_failed';
    default:
      return null;
  }
});
</script>

<template>
  <section
    class="agent-sheet shrink-0 border-b bg-card/60"
    :aria-label="$t('sheet.label')"
  >
    <!-- The fold line: identity, status, and the toggle. Always visible. -->
    <div class="flex items-center gap-3 px-4 py-2.5">
      <div
        class="flex shrink-0 items-center justify-center rounded-[14px] border bg-linear-to-br from-[#4a3356] to-[#251b2b] font-semibold text-foreground transition-[width,height] duration-300"
        :class="open ? 'h-12 w-12 text-base' : 'h-9 w-9 text-xs'"
        :style="{ borderColor: agent ? meta.color : undefined }"
      >
        {{ agent ? initials : '·' }}
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <h1 class="truncate text-sm font-semibold">
            <template v-if="agent">{{ agent.name }}</template>
            <template v-else-if="pending">{{ $t('chat.loading') }}</template>
            <template v-else>{{ $t('chat.not_found') }}</template>
          </h1>
          <span
            v-if="agent"
            class="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span class="relative flex h-1.5 w-1.5">
              <span
                v-if="meta.pulse"
                class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                :style="{ background: meta.color }"
              />
              <span
                class="relative inline-flex h-1.5 w-1.5 rounded-full"
                :style="{ background: meta.color }"
              />
            </span>
            {{ meta.labelKey ? $t(meta.labelKey) : agent.status }}
          </span>
        </div>
        <p
          v-if="agent"
          class="agent-sheet__class mt-0.5 truncate text-[12px] uppercase tracking-[0.08em] text-primary"
        >
          {{ $t(agent.isAdmin ? 'sheet.class_admin' : 'sheet.class_agent') }}
        </p>
      </div>

      <button
        type="button"
        class="shrink-0 rounded-full border bg-background p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        :aria-expanded="open"
        :aria-label="$t(open ? 'sheet.fold' : 'sheet.unfold')"
        @click="toggle"
      >
        <Icon
          name="chevron-down"
          :size="14"
          class="transition-transform duration-300"
          :class="open ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <div v-if="open && agent" class="px-4 pb-3">
      <dl class="agent-sheet__rows text-[12.5px]">
        <div>
          <dt>{{ $t('sheet.template') }}</dt>
          <dd class="font-mono text-[11.5px]" :title="agent.templateId">
            {{ agent.templateId }}
          </dd>
        </div>
        <div>
          <dt>{{ $t('sheet.resources') }}</dt>
          <dd class="font-mono text-[11.5px]">
            {{ agent.resources.cpu }} CPU · {{ agent.resources.memory }}
          </dd>
        </div>
        <div>
          <dt>{{ $t('sheet.access') }}</dt>
          <dd class="font-mono text-[11.5px]">
            {{ $t(agent.isPublic ? 'sheet.access_public' : 'sheet.access_private') }}
            <template v-if="agent.allowedOrigins.length">
              · {{ $t('sheet.origins', { count: agent.allowedOrigins.length }, agent.allowedOrigins.length) }}
            </template>
          </dd>
        </div>
        <div v-if="created || updated">
          <dt>{{ $t('sheet.age') }}</dt>
          <dd class="font-mono text-[11.5px]">
            <template v-if="created">{{ created }}</template>
            <template v-if="created && updated"> · </template>
            <template v-if="updated">
              {{ $t('sheet.updated', { when: $t(updated.key, { count: updated.count }) }) }}
            </template>
          </dd>
        </div>
      </dl>

      <!-- `relative` anchors the share and new-chat popovers to this block. -->
      <div class="relative mt-3 flex flex-wrap gap-2">
        <template v-if="canManage">
          <button
            type="button"
            class="agent-sheet__btn"
            :disabled="controls.transitioning.value"
            @click="controls.restart()"
          >
            <Icon
              :name="controls.transitioning.value ? 'loader-2' : 'refresh-cw'"
              :size="13"
              :class="controls.transitioning.value ? 'animate-spin' : undefined"
            />
            {{ $t(controls.transitioning.value ? 'chat.restarting' : 'chat.restart') }}
          </button>
          <button
            v-if="controls.canStart.value"
            type="button"
            class="agent-sheet__btn"
            :disabled="controls.busy.value !== null"
            @click="controls.start()"
          >
            <Icon
              :name="controls.busy.value === 'start' ? 'loader-2' : 'play'"
              :size="13"
              :class="controls.busy.value === 'start' ? 'animate-spin' : undefined"
            />
            {{ $t(controls.busy.value === 'start' ? 'sheet.starting' : 'sheet.start') }}
          </button>
          <button
            v-else
            type="button"
            class="agent-sheet__btn"
            :disabled="controls.busy.value !== null"
            @click="controls.stop()"
          >
            <Icon
              :name="controls.busy.value === 'stop' ? 'loader-2' : 'square'"
              :size="13"
              :class="controls.busy.value === 'stop' ? 'animate-spin' : undefined"
            />
            {{ $t(controls.busy.value === 'stop' ? 'sheet.stopping' : 'sheet.stop') }}
          </button>
        </template>

        <!-- No role gate: whoever can open the agent may share it and start
             their conversation over (spec clarification, 2026-09-07). -->
        <SharePanelProvider :agent-id="agent.id" />
        <BridleChatNewChat v-if="conversation" :conversation="conversation" />
      </div>

      <p
        v-if="failedKey"
        class="mt-2 text-xs text-rose-700 dark:text-rose-400"
        role="alert"
      >
        {{ $t(failedKey) }}<template v-if="controls.failed.value?.message">: {{ controls.failed.value.message }}</template>
      </p>
    </div>
  </section>
</template>

<style scoped>
.agent-sheet__class {
  font-family: DotGothic16, 'Geist Mono', monospace;
}
.agent-sheet__rows > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid color-mix(in oklab, var(--foreground) 7%, transparent);
}
.agent-sheet__rows dt {
  color: var(--muted-foreground);
  flex: none;
}
.agent-sheet__rows dd {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.agent-sheet__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--background);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--foreground);
  transition: background-color 150ms;
}
.agent-sheet__btn:hover {
  background: var(--muted);
}
.agent-sheet__btn:disabled {
  opacity: 0.6;
}
</style>
