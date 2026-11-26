<script setup lang="ts">
import type { IAgentData } from '#agent/domain';
import type { IBridleConversation } from '#bridle/domain';
import { agentInitials, agentStatusMeta } from '#agent/utils/agentStatus';
import { relativeTime } from '#agent/utils/relativeTime';
import { counterLabel, type PanelView } from '#agent/utils/panelView';
import { agentCreator, ownerMark, ownershipNote } from '#agent/utils/agentOwnership';
import { agentAbilitiesThroughAssistant } from '#assistantAccess/utils/assistantAccess';

/**
 * The character sheet: who the open agent is and what can be done to it,
 * above its chat. Folds to one line so the chat gets the height back; the
 * fold is remembered per browser.
 */
const props = defineProps<{
  agent: IAgentData | null | undefined;
  pending: boolean;
  canManage: boolean;
  /** What stands under the sheet (CLEAN-248); the switch shows and sets it. */
  view: PanelView['kind'];
}>();
defineEmits<{ 'to-chat': []; 'to-list': [] }>();

const SHEET_KEY = 'agent:sheetOpen';

// Folded by default: the chat is what the page is for, and the actions are in
// the fold line anyway. Opening it is remembered per browser.
const open = ref(false);
onMounted(() => {
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(SHEET_KEY);
  } catch {
    // Private mode — the default stands.
  }
  if (saved === '1') open.value = true;
  else open.value = false;
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
// The tool-server mark (CLEAN-245) beside the status, for a manager; the
// sentence that names the server is the chat's, right below.
const toolMark = computed(() =>
  props.canManage && props.agent?.status === 'running'
    ? props.agent.toolState
    : null,
);
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

// Request limits (CLEAN-224): this console says only whether the agent has
// them. Asked when the rows are on screen, and again when the agent's
// visibility changes — making an agent public is when limits get set. The
// answer is held in the agent store by id and read from there.
const agentStore = useAgentStore();
const limitsEnabled = computed(() =>
  props.agent ? agentStore.limitsEnabledFor(props.agent.id) : undefined,
);
watch(
  () => (open.value && props.agent ? `${props.agent.id}:${props.agent.isPublic}` : null),
  (shown) => {
    if (shown && props.agent) void agentStore.fetchLimitsEnabled(props.agent.id);
  },
  { immediate: true },
);

// The History counter (CLEAN-248): this person's closed conversations with
// the open agent, from the chat store's index. Capped for the eye; the exact
// number is in the button's name.
const chatStore = useChatStore();
const closedCount = computed(() =>
  props.agent ? chatStore.closedCountFor(props.agent.id) : null,
);
const historyCounter = computed(() => counterLabel(closedCount.value));

// Whose agent this is (CLEAN-259): the badge on the avatar, the class line,
// the words beside "Created" and the one note under the rows all come from
// the store's record through one module, so they cannot tell different
// stories. A User is told about their own agents only.
const authStore = useAuthStore();
const mark = computed(() => (props.agent ? ownerMark(props.agent, authStore.role) : null));
const creator = computed(() =>
  props.agent ? agentCreator(props.agent, authStore.role) : null,
);
// Copy decided in script travels as a key (docs/i18n.md).
const classKey = computed(() => {
  if (props.agent?.isAdmin) return 'sheet.class_admin';
  return props.agent?.createdByMe ? 'sheet.class_mine' : 'sheet.class_agent';
});

// What the assistant may do to an agent somebody else runs, for this
// person: their own record in the assistantAccess store, read once per
// account. Asked for only where the note could name it.
const assistantStore = useAssistantAccessStore();
const assistantAbilities = computed(() =>
  agentAbilitiesThroughAssistant(assistantStore.mine),
);
const note = computed(() =>
  props.agent
    ? ownershipNote(props.agent, authStore.role, assistantAbilities.value)
    : null,
);
watch(
  () => note.value !== null && note.value.kind !== 'mine',
  (wanted) => {
    if (wanted) void assistantStore.ensureMine();
  },
  { immediate: true },
);

// The last request for this agent's record failed (CLEAN-260): a fact of the
// store, so it outlives the chat being remounted and goes with the next
// answer, whoever asked for it.
const refreshFailed = computed(() =>
  props.agent ? agentStore.refreshFailedFor(props.agent.id) : false,
);
const refreshing = ref(false);
async function retryRefresh() {
  if (!props.agent || refreshing.value) return;
  refreshing.value = true;
  try {
    await agentStore.fetchById(props.agent.id);
  } finally {
    refreshing.value = false;
  }
}

const failedKey = computed(() => {
  switch (controls.failed.value?.action) {
    case 'restart':
      return 'chat.restart_failed';
    case 'stop':
      return 'sheet.stop_failed';
    case 'start':
      return 'sheet.start_failed';
    case 'pin':
      return 'sheet.pin_failed';
    default:
      return null;
  }
});
</script>

<template>
  <section
    class="agent-sheet @container shrink-0 border-b bg-card/60"
    :aria-label="$t('sheet.label')"
  >
    <!-- The fold line: identity, the conversation group, the actions and the
         toggle. Always visible. Identity and actions grow alike, which is
         what keeps the conversation group on the axis of the feed below
         (CLEAN-248). `relative` anchors the New chat confirmation when the
         sheet is narrow. -->
    <div class="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <div class="agent-sheet__identity flex min-w-0 flex-[1_1_0%] items-center gap-3">
      <div
        class="relative flex shrink-0 items-center justify-center rounded-[14px] border bg-linear-to-br from-[#4a3356] to-[#251b2b] font-semibold text-foreground transition-[width,height] duration-300"
        :class="open ? 'h-12 w-12 text-base' : 'h-9 w-9 text-xs'"
        :style="{ borderColor: agent ? meta.color : undefined }"
      >
        {{ agent ? initials : '·' }}
        <AgentOwnerMark :mark="mark" :large="open" />
      </div>

      <div class="min-w-0 flex-1">
        <!-- The name gets the room first (CLEAN-259): when it and the marks
             beside it do not fit one line, the marks go to a line of their
             own, and only a name longer than the whole line is cut. -->
        <div class="agent-sheet__name flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h1 class="min-w-0 max-w-full truncate text-sm font-semibold" :title="agent?.name">
            <template v-if="agent">{{ agent.name }}</template>
            <template v-else-if="pending">{{ $t('chat.loading') }}</template>
            <template v-else>{{ $t('chat.not_found') }}</template>
            <!-- An operator's badge names somebody else; the words for it.
                 One's own agent is said by the class line below. -->
            <span v-if="mark?.kind === 'other'" class="sr-only">
              , {{ $t('ownership.name_by', { name: mark.name }) }}
            </span>
          </h1>
          <!-- On the assistant: the level this person uses it at (CLEAN-240). -->
          <AssistantAccessBadge v-if="agent?.isAdmin" />
          <!-- The pin state, announced as one image with a name (CLEAN-216). -->
          <span
            v-if="agent?.pinned"
            class="shrink-0 text-primary"
            role="img"
            :title="$t('sheet.pinned')"
            :aria-label="$t('sheet.pinned')"
            data-pinned
          >
            <Icon name="pin" :size="13" />
          </span>
          <span
            v-if="agent"
            class="agent-sheet__status inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
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
          <span
            v-if="toolMark"
            class="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
            :data-tool-state="toolMark"
          >
            {{ $t(toolMark === 'limited' ? 'tool_state.label_limited' : 'tool_state.label_connecting') }}
          </span>
        </div>
        <p
          v-if="agent"
          class="agent-sheet__class mt-0.5 truncate text-[12px] uppercase tracking-[0.08em] text-primary"
          :class="classKey === 'sheet.class_mine' && 'agent-sheet__class--mine'"
          :data-agent-class="agent.isAdmin ? 'admin' : agent.createdByMe ? 'mine' : 'agent'"
        >
          {{ $t(classKey) }}
        </p>
      </div>
      </div>

      <!-- The conversation group: what the panel shows, and New chat. All
           that is about the conversation stands together here; what is done
           to the agent stays on the right. No role gate on New chat: whoever
           can open the agent may start their conversation over (spec
           clarification, 2026-09-07). -->
      <div v-if="agent" class="agent-sheet__talk relative flex shrink-0 items-center gap-2">
        <div
          class="inline-flex rounded-full border bg-card p-[3px]"
          role="group"
          :aria-label="$t('sheet.view_label')"
          data-panel-switch
        >
          <button
            type="button"
            class="agent-sheet__seg"
            :aria-pressed="view === 'chat'"
            :title="$t('sheet.view_chat')"
            data-panel-view="chat"
            @click="$emit('to-chat')"
          >
            <Icon name="message-square" :size="13" />
            <span class="agent-sheet__seg-label">{{ $t('sheet.view_chat') }}</span>
          </button>
          <!-- Pressed for the list and for a conversation opened from it:
               both are History. The name carries the exact count; the capped
               number beside the label is for the eye. -->
          <button
            type="button"
            class="agent-sheet__seg"
            :aria-pressed="view !== 'chat'"
            :aria-label="
              closedCount
                ? $t('sheet.view_history_count', { count: format.number(closedCount) }, closedCount)
                : $t('sheet.view_history')
            "
            :title="$t('sheet.view_history')"
            data-panel-view="history"
            @click="$emit('to-list')"
          >
            <Icon name="history" :size="13" />
            <span class="agent-sheet__seg-label">{{ $t('sheet.view_history') }}</span>
            <span
              v-if="historyCounter"
              class="agent-sheet__seg-count font-mono text-[10.5px]"
              aria-hidden="true"
              data-history-count
            >
              {{ historyCounter }}
            </span>
          </button>
        </div>
        <span v-if="conversation" class="agent-sheet__tool agent-sheet__newchat inline-flex">
          <BridleChatNewChat :conversation="conversation" @confirmed="$emit('to-chat')" />
        </span>
      </div>

      <!-- Actions sit in the fold line, by the toggle, so they are one click away
           whether the sheet is open or not (owner review). `relative` anchors the
           share popover. In a narrow column the row drops under the name. -->
      <div class="agent-sheet__actions flex flex-[1_1_0%] items-center justify-end gap-1.5 @max-[520px]:contents">
      <div v-if="agent" class="agent-sheet__tools relative flex shrink-0 flex-wrap items-center justify-end gap-1.5 @max-[520px]:order-last @max-[520px]:basis-full @max-[520px]:justify-start">
        <template v-if="canManage">
          <button
            type="button"
            class="agent-sheet__btn"
            :title="$t('chat.restart')"
            :disabled="controls.transitioning.value"
            @click="controls.restart()"
          >
            <Icon
              :name="controls.transitioning.value ? 'loader-2' : 'refresh-cw'"
              :size="13"
              :class="controls.transitioning.value ? 'animate-spin' : undefined"
            />
            <span class="sr-only">{{ $t(controls.transitioning.value ? 'chat.restarting' : 'chat.restart') }}</span>
          </button>
          <button
            v-if="controls.canStart.value"
            type="button"
            class="agent-sheet__btn"
            :title="$t('sheet.start')"
            :disabled="controls.busy.value !== null"
            @click="controls.start()"
          >
            <Icon
              :name="controls.busy.value === 'start' ? 'loader-2' : 'play'"
              :size="13"
              :class="controls.busy.value === 'start' ? 'animate-spin' : undefined"
            />
            <span class="sr-only">{{ $t(controls.busy.value === 'start' ? 'sheet.starting' : 'sheet.start') }}</span>
          </button>
          <button
            v-else
            type="button"
            class="agent-sheet__btn"
            :title="$t('sheet.stop')"
            :disabled="controls.busy.value !== null"
            @click="controls.stop()"
          >
            <Icon
              :name="controls.busy.value === 'stop' ? 'loader-2' : 'square'"
              :size="13"
              :class="controls.busy.value === 'stop' ? 'animate-spin' : undefined"
            />
            <span class="sr-only">{{ $t(controls.busy.value === 'stop' ? 'sheet.stopping' : 'sheet.stop') }}</span>
          </button>
        </template>
        <!-- Pin / unpin (CLEAN-216): optimistic, the lists reorder on the
             click; a failure rolls back and lands in the line below. Outside
             the `canManage` block: the pin is the viewer's own, so whoever
             can open the agent may set it, a User included (CLEAN-231). -->
        <button
          type="button"
          class="agent-sheet__btn"
          :title="$t(agent.pinned ? 'sheet.unpin' : 'sheet.pin')"
          :aria-pressed="agent.pinned"
          :disabled="controls.busy.value !== null"
          data-pin-toggle
          @click="controls.togglePin()"
        >
          <Icon
            :name="controls.busy.value === 'pin' ? 'loader-2' : agent.pinned ? 'pin-off' : 'pin'"
            :size="13"
            :class="controls.busy.value === 'pin' ? 'animate-spin' : undefined"
          />
          <span class="sr-only">{{ $t(agent.pinned ? 'sheet.unpin' : 'sheet.pin') }}</span>
        </button>

        <!-- No role gate: whoever can open the agent may share it (spec
             clarification, 2026-09-07). -->
        <!-- The popover is `absolute right-4 top-full` and anchors to the nearest
             positioned ancestor; without this wrapper that was the whole sheet,
             so the panel opened at the sheet's far right instead of under its button. -->
        <span class="agent-sheet__tool relative inline-flex" :title="$t('share.panel.share')">
          <SharePanelProvider :agent-id="agent.id" />
        </span>
      </div>

      <button
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground transition hover:bg-muted hover:text-foreground"
        :aria-expanded="open"
        :aria-label="$t(open ? 'sheet.fold' : 'sheet.unfold')"
        data-sheet-toggle
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
    </div>

    <p
      v-if="failedKey"
      class="px-4 pb-2 text-xs text-rose-700 dark:text-rose-400"
      role="alert"
    >
      {{ $t(failedKey) }}<template v-if="controls.failed.value?.message">: {{ controls.failed.value.message }}</template>
    </p>

    <!-- The agent's record could not be read again (CLEAN-260). The chat
         below goes on from what the console holds; this says that it may be
         behind, in the place this sheet says what failed. -->
    <p
      v-if="refreshFailed"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pb-2 text-xs text-rose-700 dark:text-rose-400"
      role="status"
      data-agent-refresh-failed
    >
      <span>{{ $t('sheet.refresh_failed') }}</span>
      <button
        type="button"
        class="rounded-full border border-current/30 px-2 py-0.5 font-medium transition hover:bg-rose-500/10 disabled:opacity-60"
        :disabled="refreshing"
        @click="retryRefresh"
      >
        {{ $t('sheet.refresh_retry') }}
      </button>
    </p>

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
          <!-- `data-limits-enabled` is a hook for browser checks; absent until
               the API has answered. -->
          <dd
            class="font-mono text-[11.5px]"
            :data-limits-enabled="limitsEnabled === undefined ? undefined : String(limitsEnabled)"
          >
            {{ $t(agent.isPublic ? 'sheet.access_public' : 'sheet.access_private') }}
            <template v-if="agent.allowedOrigins.length">
              · {{ $t('sheet.origins', { count: agent.allowedOrigins.length }, agent.allowedOrigins.length) }}
            </template>
            <template v-if="limitsEnabled !== undefined">
              · {{ $t(limitsEnabled ? 'sheet.limits_on' : 'sheet.limits_off') }}
            </template>
          </dd>
        </div>
        <div v-if="created || updated || creator">
          <dt>{{ $t('sheet.age') }}</dt>
          <!-- Three facts on one row: it may take a second line on a phone
               rather than lose the last of them to an ellipsis. -->
          <dd class="agent-sheet__wrap font-mono text-[11.5px]" :data-creator="creator?.kind">
            <template v-if="created">{{ created }}</template>
            <!-- Who created it (CLEAN-259): "by you" for one's own; a name,
                 or that none is recorded, for an Owner or Admin; nothing for
                 a User on somebody else's agent. -->
            <template v-if="creator">
              <template v-if="created"> · </template>
              <span v-if="creator.kind === 'mine'" class="text-primary">{{ $t('sheet.created_by_you') }}</span>
              <template v-else-if="creator.kind === 'other'">{{ creator.name }}</template>
              <span v-else class="text-muted-foreground">
                {{ $t(creator.kind === 'removed' ? 'sheet.creator_removed' : 'sheet.creator_unknown') }}
              </span>
            </template>
            <template v-if="(created || creator) && updated"> · </template>
            <template v-if="updated">
              {{ $t('sheet.updated', { when: $t(updated.key, { count: updated.count }) }) }}
            </template>
          </dd>
        </div>
      </dl>

      <!-- Why this person may, or may not, restart this agent (CLEAN-259).
           One note or none: theirs, theirs to act on through the assistant,
           or run by an administrator. The ability titles are the server's,
           shown as received. -->
      <p
        v-if="note"
        class="agent-sheet__note"
        :class="note.kind === 'mine' && 'agent-sheet__note--mine'"
        :data-ownership-note="note.kind"
      >
        <Icon :name="note.kind === 'mine' ? 'key-round' : 'handshake'" :size="15" aria-hidden="true" />
        <span v-if="note.kind === 'mine'">
          <b>{{ $t('ownership.note_mine_title') }}</b>
          {{ $t(note.byRoleToo ? 'ownership.note_mine' : 'ownership.note_mine_user') }}
        </span>
        <span v-else-if="note.kind === 'assistant'">
          <b>{{ $t('ownership.note_available_title') }}</b>
          {{ $t('ownership.note_assistant') }}
          <template v-for="(ability, i) in note.abilities" :key="ability">
            <template v-if="i > 0">, </template>
            <span class="text-foreground" data-note-ability>{{ ability }}</span>
          </template>
        </span>
        <span v-else>
          <b>{{ $t('ownership.note_available_title') }}</b>
          {{ $t('ownership.note_available') }}
        </span>
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
.agent-sheet__rows dd.agent-sheet__wrap {
  white-space: normal;
  text-wrap: balance;
}

/* ── The ownership note (CLEAN-259) ─────────────────────────────────── */
.agent-sheet__note {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in oklab, var(--foreground) 14%, transparent);
  border-radius: 12px;
  background: color-mix(in oklab, var(--foreground) 4%, transparent);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted-foreground);
}
.agent-sheet__note svg {
  flex: none;
  margin-top: 2px;
  color: var(--muted-foreground);
}
.agent-sheet__note b {
  font-weight: 600;
  color: var(--foreground);
}
.agent-sheet__note--mine {
  border-color: color-mix(in oklab, var(--primary) 34%, transparent);
  background: color-mix(in oklab, var(--primary) 7%, transparent);
}
.agent-sheet__note--mine svg {
  color: var(--primary);
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
.agent-sheet__tools .agent-sheet__btn {
  width: 32px;
  height: 32px;
  padding: 0;
  justify-content: center;
}
/* Share and New chat keep their own trigger buttons (they own the popovers).
   In the fold line they are drawn as icons like the rest: the label stays in
   the DOM for screen readers and only its glyphs are hidden. Scoped to the
   trigger (aria-haspopup), so the buttons inside the popovers keep their
   text. */
.agent-sheet__tool :deep(button[aria-haspopup='dialog']) {
  width: 32px;
  height: 32px;
  padding: 0;
  gap: 0;
  justify-content: center;
  font-size: 0;
}

/* ── The conversation group (CLEAN-248) ─────────────────────────────── */
.agent-sheet__seg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--muted-foreground);
  transition:
    background-color 150ms,
    color 150ms;
}
.agent-sheet__seg:hover {
  color: var(--foreground);
}
.agent-sheet__seg[aria-pressed='true'] {
  background: var(--muted);
  color: var(--foreground);
}
.agent-sheet__seg:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}
.agent-sheet__seg-count {
  color: var(--muted-foreground);
}
.agent-sheet__seg[aria-pressed='true'] .agent-sheet__seg-count {
  color: var(--primary);
}
/* With room, New chat reads as a word beside the switch, not as one more
   icon among the agent's actions. */
.agent-sheet__newchat :deep(button[aria-haspopup='dialog']) {
  width: auto;
  padding: 0 12px;
  gap: 6px;
  font-size: 12.5px;
}

/* 700 px: the prototype's value, checked against the column beside the orbit
   map (500 to 720 px). Below it the words go and the icons stay, each with
   its name and tooltip; the counter stays too. */
@container (max-width: 700px) {
  .agent-sheet__seg {
    padding: 0 10px;
  }
  .agent-sheet__seg-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .agent-sheet__newchat :deep(button[aria-haspopup='dialog']) {
    width: 32px;
    padding: 0;
    gap: 0;
    font-size: 0;
  }
  .agent-sheet__class {
    display: none;
  }
  /* "Your agent" stays: it is the words for the badge on the avatar, and
     it says why the controls are here (CLEAN-259). */
  .agent-sheet__class.agent-sheet__class--mine {
    display: block;
  }
  /* In a narrow column the name is what has to be read (CLEAN-259): the
     actions take what their buttons need and the identity all the rest,
     instead of half each. Half was less than the buttons need once an agent
     has all four, and they ran over the conversation group. With room to
     spare both sides grow alike, which keeps that group on the axis of the
     feed (CLEAN-248). Below 520 px the actions are not a box at all. */
  .agent-sheet__actions {
    flex: 0 0 auto;
  }
  /* The confirmation is anchored to the whole line here: under a button in
     the middle of a narrow sheet it would run off the left edge. */
  .agent-sheet__talk {
    position: static;
  }
}

/* A phone: the conversation group takes its share of the first line, and
   what is left has to go to the agent's name. The status keeps its dot (the
   colour says it) and gives up its word, which stays in the page for a
   screen reader. */
@container (max-width: 520px) {
  .agent-sheet__status {
    gap: 0;
    padding: 0;
    border: 0;
    background: none;
    font-size: 0;
  }
}
</style>
