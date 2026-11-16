<script setup lang="ts">
/**
 * Configuration (CLEAN-228, User Story 3): what used to need the separate
 * Edit page — name, description, model, knowledge, resources — edited where
 * it stands, on the page's one draft. Nothing here saves; the bar at the
 * bottom of the page does.
 *
 * The agent, the credentials, the knowledge bases and the template are read
 * from their stores; the only state of this block's own is the text being
 * typed into a field and the "own selection, nothing ticked yet" choice the
 * draft cannot hold.
 */
import { IconLock } from '@tabler/icons-vue'
import { useInjectedAgentDraft } from '#agent/composables/useAgentDraft'
import { useInjectedAgentMetrics } from '#agent/composables/useAgentMetrics'
import { useAgentKnowledges } from '#agent/composables/useAgentKnowledges'
import {
  formatBytes,
  formatCpuMilli,
  usagePct,
} from '#agent/utils/agentFormat'
import { formatNumber } from '#common/utils/format'

const props = defineProps<{ agentId: string }>()

const draft = useInjectedAgentDraft()
const { errors, saving } = draft

const agentStore = useAgentStore()
const llmStore = useLlmStore()
const knowledgeStore = useKnowledgeStore()

const agent = computed(() => agentStore.byId(props.agentId))
const uid = useId()

// A changed control wears a ring until it is saved or discarded (FR-017).
const CHANGED = 'border-amber-500/70 ring-2 ring-amber-500/45'

// ── Text fields ──────────────────────────────────────────────────────
// A text field cannot be driven by the draft's value alone: "Rancher " and
// "Rancher" are the same name, so the draft drops the edit and hands back the
// saved text — which would eat the space just typed. Each field remembers its
// own text and shows it for as long as it still says what the draft holds.
// After a discard, a save or a change from elsewhere it no longer does, and
// the field shows the draft again.
type TextField = 'name' | 'description' | 'cpu' | 'memory'

const typed = reactive<Record<TextField, string | null>>({
  name: null,
  description: null,
  cpu: null,
  memory: null,
})

function text(field: TextField): string {
  const held = draft.value(field)
  const own = typed[field]
  if (own !== null && own.trim() === held.trim()) return own
  return held
}

function setText(field: TextField, value: string | number) {
  typed[field] = String(value ?? '')
  draft.set(field, typed[field] ?? '')
}

function onNativeInput(field: TextField, event: Event) {
  setText(field, (event.target as HTMLInputElement).value)
}

// ── Model ────────────────────────────────────────────────────────────
// Same key as the header's usage line: one request serves both.
const { pending: llmsPending } = useAsyncData(
  'admin-llms-for-agent',
  () => llmStore.fetchAll(),
  { lazy: true },
)

// Reka UI disallows an empty-string item value, so "None" travels as a
// sentinel and is `null` at the edges.
const LLM_NONE = '__none__'

const chosenLlmId = computed(() => draft.value('llmCredentialId'))
const chosenLlm = computed(() =>
  chosenLlmId.value
    ? llmStore.items.find((c) => c.id === chosenLlmId.value) ?? null
    : null,
)

// Active credentials, plus the one the agent runs on now if it has since been
// switched off — it is still what is saved, and must be shown as such.
const llmOptions = computed(() =>
  llmStore.items.filter(
    (c) => c.status === 'active' || c.id === chosenLlmId.value || c.id === agent.value?.llmCredentialId,
  ),
)

function llmLabel(c: { provider: string; model: string; label: string | null; status: string }): string {
  const label = c.label ? ` (${c.label})` : ''
  const off = c.status === 'active' ? '' : ` — ${c.status}`
  return `${c.provider} · ${c.model}${label}${off}`
}

function setLlm(value: unknown) {
  const id = typeof value === 'string' ? value : LLM_NONE
  draft.set('llmCredentialId', id === LLM_NONE ? null : id)
}

// ── Knowledge ────────────────────────────────────────────────────────
const { template, pending: knowledgePending } = useAgentKnowledges(
  props.agentId,
  agent,
)

const { status: knowledgeStatus } = useAsyncData(
  'admin-knowledge-status',
  () => knowledgeStore.fetchStatus(),
  { lazy: true },
)
// Waiting only while the question is still out: a status request that failed
// reads as "disabled", with its sentence, not as a skeleton for ever.
const knowledgeWaiting = computed(
  () =>
    knowledgePending.value ||
    (!knowledgeStore.statusChecked &&
      (knowledgeStatus.value === 'pending' || knowledgeStatus.value === 'idle')),
)

const bases = computed(() => knowledgeStore.items)
const knowledgeIds = computed(() => draft.value('knowledgeIds'))

// "Own selection" with nothing ticked is not something the platform can hold
// (an empty list IS "the template's"), so it lives here until a base is
// ticked — and goes with a discard.
const ownOpen = ref(false)
watch(draft.resets, () => {
  ownOpen.value = false
})

const knowledgeMode = computed<'template' | 'own'>(() =>
  knowledgeIds.value.length > 0 || ownOpen.value ? 'own' : 'template',
)

function chooseTemplate() {
  ownOpen.value = false
  draft.set('knowledgeIds', [])
}

function chooseOwn() {
  ownOpen.value = true
}

function toggleBase(id: string, checked: boolean) {
  const current = knowledgeIds.value
  const next = checked
    ? current.includes(id) ? current : [...current, id]
    : current.filter((x) => x !== id)
  // Emptied by hand: still "own", still unfinished.
  ownOpen.value = true
  draft.set('knowledgeIds', next)
}

function onBaseChange(id: string, event: Event) {
  toggleBase(id, (event.target as HTMLInputElement).checked)
}

function sourcesOf(k: { sourcesCount?: number; sourceCount: number }): number {
  return k.sourcesCount ?? k.sourceCount ?? 0
}

// Bindings that point at bases which no longer exist. Shown, never dropped
// silently: unticking is how the operator removes one.
const missingIds = computed(() => {
  if (knowledgePending.value) return [] as string[]
  const known = new Set(bases.value.map((k) => k.id))
  return knowledgeIds.value.filter((id) => !known.has(id))
})

const templateBaseNames = computed(() => {
  const ids = template.value?.defaultKnowledgeIds ?? []
  const names: string[] = []
  for (let i = 0; i < ids.length; i += 1) {
    const base = bases.value.find((k) => k.id === ids[i])
    names.push(base ? base.name : 'a base that no longer exists')
  }
  return names
})

const knowledgeState = computed(() => {
  if (knowledgeMode.value === 'own') {
    return knowledgeIds.value.length > 0
      ? 'Only the bases ticked below.'
      : 'Tick at least one base. Until then the template\'s are used.'
  }
  if (!template.value) return ''
  return templateBaseNames.value.length
    ? `Template binds: ${templateBaseNames.value.join(', ')}.`
    : 'Template binds none.'
})

// ── Resources ────────────────────────────────────────────────────────
// Live headroom for the two fields. Values are burst limits, so the useful
// ceiling is the largest free chunk on one agent node — context while picking
// numbers, not a cap.
const capacity = computed(() => agentStore.capacity)
onMounted(() => {
  void agentStore.fetchCapacity()
})

const { metrics } = useInjectedAgentMetrics()

const inUseNow = computed(() => {
  const pod = metrics.value?.pod
  if (!pod) return ''
  const cpu = pod.cpuLimitMilli > 0
    ? `${usagePct(pod.cpuMilli, pod.cpuLimitMilli)}% CPU`
    : `${formatCpuMilli(pod.cpuMilli)} CPU`
  const memory = pod.memLimitBytes > 0
    ? `${usagePct(pod.memBytes, pod.memLimitBytes)}% memory`
    : `${formatBytes(pod.memBytes)} memory`
  return `${cpu}, ${memory}`
})

const UNIT =
  'inline-flex items-center overflow-hidden rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50'
const UNIT_INPUT =
  'h-8 w-[82px] min-w-0 bg-transparent px-2.5 text-[13.5px] outline-none disabled:opacity-50 max-[760px]:w-16'
const UNIT_LABEL =
  'grid h-8 place-items-center border-l bg-muted px-2.5 text-xs text-muted-foreground'
</script>

<template>
  <section v-if="agent" class="rounded-xl border bg-card" data-block="config">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 pt-4">
      <h2 class="text-[15px] font-semibold">Configuration</h2>
      <p class="basis-full text-[13px] text-muted-foreground">
        Edit in place. Changes apply when you save.
      </p>
    </header>

    <div class="px-5 pb-2 pt-1.5">
      <!-- Name -->
      <AgentOverviewRow label="Name" :for="`${uid}-name`">
        <Input
          :id="`${uid}-name`"
          :model-value="text('name')"
          autocomplete="off"
          :disabled="saving"
          :aria-invalid="errors.name ? 'true' : undefined"
          :aria-describedby="errors.name ? `${uid}-name-error` : undefined"
          :class="['max-w-80', draft.changed('name') && CHANGED]"
          data-field="name"
          :data-changed="draft.changed('name') ? '' : undefined"
          @update:model-value="(v: string | number) => setText('name', v)"
        />
        <p
          v-if="errors.name"
          :id="`${uid}-name-error`"
          class="text-xs text-destructive"
          role="alert"
          data-field-error="name"
        >
          {{ errors.name.text }}
        </p>
      </AgentOverviewRow>

      <!-- Description -->
      <AgentOverviewRow label="Description" :for="`${uid}-description`">
        <template #hint>Shown on the A2A card</template>
        <Textarea
          :id="`${uid}-description`"
          :model-value="text('description')"
          rows="2"
          placeholder="What should other agents ask this one about?"
          :disabled="saving"
          :class="['min-h-14', draft.changed('description') && CHANGED]"
          data-field="description"
          :data-changed="draft.changed('description') ? '' : undefined"
          @update:model-value="(v: string | number) => setText('description', v)"
        />
        <p class="text-xs text-muted-foreground">
          Empty: the template description is used.
        </p>
      </AgentOverviewRow>

      <!-- Model -->
      <AgentOverviewRow label="Model" :for="`${uid}-llm`">
        <template #hint>LLM credential</template>
        <div class="flex flex-wrap items-center gap-2">
          <Select
            :model-value="chosenLlmId ?? LLM_NONE"
            :disabled="saving"
            @update:model-value="setLlm"
          >
            <SelectTrigger
              :id="`${uid}-llm`"
              :class="['w-full max-w-80 min-w-0 [&>span]:truncate', draft.changed('llmCredentialId') && CHANGED]"
              data-field="llm"
              :data-value="chosenLlmId ?? ''"
              :data-changed="draft.changed('llmCredentialId') ? '' : undefined"
            >
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="LLM_NONE">None</SelectItem>
              <SelectItem v-for="l in llmOptions" :key="l.id" :value="l.id">
                {{ llmLabel(l) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Badge
            v-if="chosenLlm"
            :variant="chosenLlm.status === 'active' ? 'default' : 'outline'"
            class="capitalize"
            data-llm-state
          >
            {{ chosenLlm.status }}
          </Badge>
          <NuxtLink to="/llms" class="text-[12.5px] underline underline-offset-2">
            Manage credentials
          </NuxtLink>
        </div>
        <p v-if="chosenLlm" class="text-xs text-muted-foreground">
          <span class="capitalize">{{ chosenLlm.provider }}</span>
          · <span class="font-mono break-all">{{ chosenLlm.model }}</span>
          <template v-if="chosenLlm.label"> · {{ chosenLlm.label }}</template>
          <template v-if="chosenLlm.fallbackModel">
            · Fallback model:
            <span class="font-mono break-all">{{ chosenLlm.fallbackModel }}</span>
          </template>
        </p>
        <p v-else-if="chosenLlmId && !llmsPending" class="text-xs text-destructive">
          This credential no longer exists. Pick another one.
        </p>
        <p v-else-if="!chosenLlmId" class="text-xs text-muted-foreground">
          No credential: the pod runs without <span class="font-mono">LLM_*</span> settings.
        </p>
      </AgentOverviewRow>

      <!-- Knowledge -->
      <AgentOverviewRow label="Knowledge">
        <template #hint>Bases for <span class="font-mono">query_knowledge</span></template>
        <div
          class="flex min-w-0 flex-col gap-2"
          data-field="knowledge"
          :data-changed="draft.changed('knowledgeIds') ? '' : undefined"
        >
          <div v-if="knowledgeWaiting" class="flex gap-2">
            <Skeleton class="h-8 w-56 motion-reduce:animate-none" />
          </div>
          <p
            v-else-if="!knowledgeStore.enabled"
            class="text-[13px] text-muted-foreground min-[760px]:pt-[7px]"
          >
            Knowledge service is disabled. Configure the URL in
            <NuxtLink to="/settings" class="underline">Settings</NuxtLink>
            to attach knowledge bases.
          </p>
          <p
            v-else-if="!bases.length && !knowledgeIds.length"
            class="text-[13px] text-muted-foreground min-[760px]:pt-[7px]"
          >
            No knowledge bases yet. Create one in
            <NuxtLink to="/knowledges" class="underline">Knowledges</NuxtLink>.
          </p>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <div
                class="inline-flex max-w-full flex-wrap gap-0.5 rounded-[9px] bg-muted p-[3px]"
                :class="draft.changed('knowledgeIds') && 'ring-2 ring-amber-500/45'"
                role="group"
                aria-label="Knowledge source"
              >
                <button
                  type="button"
                  class="min-h-7 rounded-[7px] px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  :class="knowledgeMode === 'template'
                    ? 'bg-background font-medium text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'"
                  :aria-pressed="knowledgeMode === 'template'"
                  :disabled="saving"
                  data-knowledge-mode="template"
                  @click="chooseTemplate"
                >
                  From template
                </button>
                <button
                  type="button"
                  class="min-h-7 rounded-[7px] px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  :class="knowledgeMode === 'own'
                    ? 'bg-background font-medium text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'"
                  :aria-pressed="knowledgeMode === 'own'"
                  :disabled="saving"
                  data-knowledge-mode="own"
                  @click="chooseOwn"
                >
                  Choose for this agent
                </button>
              </div>
              <span class="min-w-0 text-[12.5px] text-muted-foreground" data-knowledge-state>
                {{ knowledgeState }}
              </span>
            </div>

            <div
              v-if="knowledgeMode === 'own'"
              class="max-h-[190px] overflow-auto rounded-[10px] border"
              role="group"
              aria-label="Knowledge bases for this agent"
            >
              <label
                v-for="k in bases"
                :key="k.id"
                class="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t px-3 py-2 text-[13px] first:border-t-0 hover:bg-muted/50"
                :data-knowledge-option="k.id"
              >
                <input
                  type="checkbox"
                  class="size-4 shrink-0 accent-primary"
                  :checked="knowledgeIds.includes(k.id)"
                  :disabled="saving"
                  @change="onBaseChange(k.id, $event)"
                />
                <span class="min-w-0 break-words">{{ k.name }}</span>
                <span class="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  {{ formatNumber(sourcesOf(k)) }}
                  {{ sourcesOf(k) === 1 ? 'source' : 'sources' }}
                  <KnowledgeIndexStatusBadge :status="k.indexStatus" />
                </span>
              </label>
              <label
                v-for="id in missingIds"
                :key="id"
                class="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5 border-t px-3 py-2 text-[13px] first:border-t-0"
                :data-knowledge-option="id"
              >
                <input
                  type="checkbox"
                  class="size-4 shrink-0 accent-primary"
                  checked
                  :disabled="saving"
                  @change="onBaseChange(id, $event)"
                />
                <span class="min-w-0 font-mono text-xs break-all">{{ id }}</span>
                <span class="ml-auto text-xs text-destructive">no longer exists</span>
              </label>
            </div>
          </template>
        </div>
      </AgentOverviewRow>

      <!-- Resources -->
      <AgentOverviewRow label="Resources">
        <template #hint>Overrides the template</template>
        <div class="flex flex-wrap items-center gap-2">
          <span :class="[UNIT, draft.changed('cpu') && CHANGED]">
            <input
              :value="text('cpu')"
              aria-label="CPU"
              placeholder="500m"
              autocomplete="off"
              :disabled="saving"
              :aria-invalid="errors.cpu ? 'true' : undefined"
              :class="UNIT_INPUT"
              data-field="cpu"
              :data-changed="draft.changed('cpu') ? '' : undefined"
              @input="onNativeInput('cpu', $event)"
            />
            <span :class="UNIT_LABEL" aria-hidden="true">CPU</span>
          </span>
          <span :class="[UNIT, draft.changed('memory') && CHANGED]">
            <input
              :value="text('memory')"
              aria-label="Memory"
              placeholder="512Mi"
              autocomplete="off"
              :disabled="saving"
              :aria-invalid="errors.memory ? 'true' : undefined"
              :class="UNIT_INPUT"
              data-field="memory"
              :data-changed="draft.changed('memory') ? '' : undefined"
              @input="onNativeInput('memory', $event)"
            />
            <span :class="UNIT_LABEL" aria-hidden="true">Memory</span>
          </span>
        </div>
        <p v-if="errors.cpu" class="text-xs text-destructive" role="alert" data-field-error="cpu">
          {{ errors.cpu.text }}
        </p>
        <p v-if="errors.memory" class="text-xs text-destructive" role="alert" data-field-error="memory">
          {{ errors.memory.text }}
        </p>
        <p class="text-xs text-muted-foreground" data-resources-help>
          Applied on the next restart.<template v-if="inUseNow"> In use now: {{ inUseNow }}.</template>
        </p>
        <p v-if="capacity" class="text-xs text-muted-foreground" data-resources-capacity>
          These are burst limits — scheduling always reserves
          {{ formatCpuMilli(capacity.slotCpuMilli) }} /
          {{ formatBytes(capacity.slotMemBytes) }} per agent regardless.
          Free on agent nodes right now:
          <span class="font-medium text-foreground">{{ formatCpuMilli(capacity.maxNodeFreeCpuMilli) }}</span>
          ·
          <span class="font-medium text-foreground">{{ formatBytes(capacity.maxNodeFreeMemBytes) }}</span>
          ·
          <span :class="capacity.freeAgentSlots === 0 ? 'font-medium text-amber-700' : ''">
            {{ formatNumber(capacity.freeAgentSlots) }}
            {{ capacity.freeAgentSlots === 1 ? 'slot' : 'slots' }} free
          </span>
        </p>
      </AgentOverviewRow>

      <!-- Template -->
      <AgentOverviewRow label="Template">
        <div class="flex min-h-[34px] flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px]">
          <NuxtLink
            :to="`/templates/${agent.templateId}`"
            class="min-w-0 break-words text-primary underline-offset-2 hover:underline"
            data-template-link
          >
            {{ template?.name || agent.templateId }}
          </NuxtLink>
          <span class="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
            <IconLock class="size-3.5" aria-hidden="true" />
            Fixed after creation
          </span>
        </div>
      </AgentOverviewRow>
    </div>
  </section>
</template>
