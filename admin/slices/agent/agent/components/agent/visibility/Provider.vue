<script setup lang="ts">
import type { IAgentData } from '#agent/stores/agent'
import type { LimitWindowTypes } from '#agent/domain/agentLimit.types'
import {
  LIMIT_FIELDS,
  findLimitProblem,
  formToLimits,
  isLimitFormEmpty,
  limitsToForm,
  placeRefusal,
  type ILimitFormValues,
  type ILimitProblem,
} from '#agent/utils/agentLimitForm'
import { formatNumber } from '#common/utils/format'
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconLoader2,
  IconX,
} from '@tabler/icons-vue'

const props = defineProps<{
  agentId: string
  apiUrl: string
  isPublic: boolean
  allowedOrigins: string[]
}>()

const emit = defineEmits<{
  saved: [agent: IAgentData]
}>()

const agentStore = useAgentStore()
const limitStore = useAgentLimitStore()
const shareStore = useShareStore()

// ── What is saved ────────────────────────────────────────────────────
// The public flag and the origins are the agent record's (props, fed by the
// agent store); the limits, the 30-day peaks and the "public without limits"
// flag are the limit store's record for this agent (docs/state.md). Nothing
// here keeps a copy of either — the form below is the only local state, and it
// holds what is being typed, not what is saved.
const limitEntry = computed(() => limitStore.byAgent[props.agentId])
// `undefined`: not read yet. `null`: read, and limits are off.
const savedLimits = computed(() => limitEntry.value?.limits)
const limitsKnown = computed(() => savedLimits.value !== undefined)
const peaks = computed(() => limitEntry.value?.load?.peaks ?? null)

// Public before limits existed (spec case 8): it keeps working uncapped, and
// this card says so until someone sets a limit.
const needsLimits = computed(
  () =>
    limitEntry.value?.needsLimits === true ||
    (props.isPublic && savedLimits.value === null),
)

const limitsLoadError = ref<string | null>(null)

// Limits and load are two reads on purpose: the limits are what Save needs,
// the load only adds "highest seen". A failed load must not block the form.
async function loadLimits() {
  limitsLoadError.value = null
  const [limits] = await Promise.allSettled([
    limitStore.fetchLimits(props.agentId),
    limitStore.fetchLoad(props.agentId),
  ])
  if (limits.status === 'rejected' && !limitsKnown.value) {
    limitsLoadError.value =
      (limits.reason as Error)?.message || 'Could not load the limits'
  }
}

// ── The form ─────────────────────────────────────────────────────────
// One Save for the switch, the origins and the limits (FR-010): a private
// agent goes public, limits included, in one request.

interface IVisibilityForm extends ILimitFormValues {
  isPublic: boolean
  originsText: string
}

function parseOrigins(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

const baseline = computed<IVisibilityForm>(() => ({
  isPublic: props.isPublic,
  originsText: props.allowedOrigins.join('\n'),
  ...limitsToForm(savedLimits.value),
}))

const form = reactive<IVisibilityForm>({ ...baseline.value })

function differsFrom(saved: IVisibilityForm): boolean {
  return (
    form.isPublic !== saved.isPublic ||
    parseOrigins(form.originsText).join('\n') !==
      parseOrigins(saved.originsText).join('\n') ||
    form.minute.trim() !== saved.minute ||
    form.hour.trim() !== saved.hour ||
    form.day.trim() !== saved.day
  )
}

const dirty = computed(() => differsFrom(baseline.value))

function resetForm() {
  Object.assign(form, baseline.value)
  problem.value = null
  saveError.value = null
}

// What is saved changed under the form (the first read landing, a save from
// the Ranch agent, another tab). Follow it — unless something is being typed:
// an edit in progress is never overwritten by a poll.
watch(baseline, (next, previous) => {
  if (!differsFrom(previous)) Object.assign(form, next)
})

const submitting = ref(false)
const justSaved = ref(false)
let justSavedTimer: ReturnType<typeof setTimeout> | null = null
// A refused save, placed next to the field it concerns.
const problem = ref<ILimitProblem | null>(null)
// Any other failure of a save (network, a rejected origin, …).
const saveError = ref<string | null>(null)

// The sentence belongs to what was sent; once the fields change it is stale.
watch(
  () => [form.isPublic, form.minute, form.hour, form.day, form.originsText],
  () => {
    problem.value = null
    saveError.value = null
  },
)

async function onSave() {
  if (submitting.value || !limitsKnown.value) return
  problem.value = null
  saveError.value = null
  const values: ILimitFormValues = {
    minute: form.minute,
    hour: form.hour,
    day: form.day,
  }
  // Text that is not a limit, or two limits that contradict each other,
  // cannot be sent as numbers at all: said at once. Whether a PUBLIC agent
  // may be saved without limits is the server's rule and the server's answer
  // (`isPublic: false` here skips that check) — its refusal comes back below.
  const unsendable = findLimitProblem(values, false)
  if (unsendable) {
    problem.value = unsendable
    return
  }

  const limits = formToLimits(values)
  const isPublic = form.isPublic
  const allowedOrigins = parseOrigins(form.originsText)
  // Origins and the public flag reach the running pod on its next start;
  // limits take effect on the next request (FR-018) and need none.
  const needsRestart =
    isPublic !== props.isPublic ||
    allowedOrigins.join('\n') !== props.allowedOrigins.join('\n')

  submitting.value = true
  let updated: IAgentData | null = null
  // One `PUT /agents/:id` carries all three. It goes through the limit
  // store's `save`, so the limits record moves optimistically with it and
  // moves back if the server refuses; the agent record is only ever written
  // from the server's answer (`agentStore.update` upserts it).
  const result = await limitStore.save(props.agentId, limits, async () => {
    updated = await agentStore.update(props.agentId, {
      isPublic,
      allowedOrigins,
      limits,
    })
  })
  submitting.value = false

  if (!result.ok) {
    const placed = placeRefusal(result.code, result.message, values, isPublic)
    if (placed) problem.value = placed
    else saveError.value = result.message
    return
  }

  if (needsRestart) agentStore.markPendingRestart(props.agentId)
  if (updated) emit('saved', updated)
  // The load snapshot carries `needsLimits` and the windows' ceilings; bring
  // it in line now rather than on the next poll.
  void limitStore.fetchLoad(props.agentId).catch(() => undefined)
  await nextTick()
  Object.assign(form, baseline.value)
  justSaved.value = true
  if (justSavedTimer) clearTimeout(justSavedTimer)
  justSavedTimer = setTimeout(() => {
    justSaved.value = false
  }, 2500)
}

function setLimitText(window: LimitWindowTypes, value: string | number) {
  form[window] = String(value ?? '')
}

function peakOf(window: LimitWindowTypes): number {
  return peaks.value?.[window] ?? 0
}

const PEAK_TITLES: Record<LimitWindowTypes, string> = {
  minute: 'Most requests accepted in any one minute of the last 30 days',
  hour: 'Most requests accepted in any 60 minutes of the last 30 days',
  day: 'Most requests accepted in any 24 hours of the last 30 days',
}

// A private agent is not closed to someone holding its share link (FR-007):
// warn while the form says "private, no limits" and a link is active. Read
// from the share store — the same record the header's Share menu shows.
const shareActive = computed(
  () => shareStore.linkFor(props.agentId)?.active === true,
)
const showShareWarning = computed(
  () => !form.isPublic && shareActive.value && isLimitFormEmpty(form),
)

onMounted(() => {
  void loadLimits()
  if (!shareStore.linkFor(props.agentId)) void shareStore.loadLink(props.agentId)
  scrollIfLinkedTo()
})

// The chat's "Limits" link lands here by anchor. The card is rendered after
// the route settles, so the browser's own jump has nothing to jump to — and
// when Overview is already open, only the hash changes.
const route = useRoute()
function scrollIfLinkedTo() {
  if (route.hash !== '#visibility-embed') return
  void nextTick(() => {
    document.getElementById('visibility-embed')?.scrollIntoView({ block: 'start' })
  })
}
watch(() => route.hash, scrollIfLinkedTo)

onBeforeUnmount(() => {
  if (justSavedTimer) clearTimeout(justSavedTimer)
})

const SDK_URL = 'https://bridle.cleanslice.org/sdk/latest.js'

// For public agents whose origin matches the whitelist the hub accepts the WS
// without a JWT (see bridleClientWs.handler), so the snippet can omit
// `data-token` entirely. Private agents always need a server-minted token.
const embedFloating = computed(
  () => `<script
  src="${SDK_URL}"
  data-api-url="${props.apiUrl}"
  data-agent-id="${props.agentId}"${props.isPublic ? '' : '\n  data-token="<JWT minted by your backend>"'}
><\/script>`,
)

const embedInline = computed(
  () => `<div id="bridle-chat" style="height: 600px; max-width: 480px;"></div>
<script
  src="${SDK_URL}"
  data-api-url="${props.apiUrl}"
  data-agent-id="${props.agentId}"
  data-mode="inline"
  data-mount="#bridle-chat"${props.isPublic ? '' : '\n  data-token="<JWT minted by your backend>"'}
><\/script>`,
)

// Backend snippet for /auth/embed/token. The Ranch API key with the
// `embed:mint` scope mints short-lived JWTs the browser uses as
// `data-token`. Default TTL is 15m; pass `expiresIn` to lift it (e.g.
// '24h', '7d', '30d'). The key never leaves the server.
const mintTokenCurl = computed(
  () => `curl -X POST "${props.apiUrl}/auth/embed/token" \\
  -H "Authorization: Bearer $RANCH_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"sub":"user-123","email":"alice@example.com","expiresIn":"7d"}'`,
)

const copiedKey = ref<string | null>(null)
async function copy(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 1500)
  } catch {
    // Clipboard write fails silently in restricted contexts (e.g. iframes
    // without permission) — surfacing an error toast is more noise than help.
  }
}
</script>

<template>
  <Card id="visibility-embed" class="scroll-mt-4">
    <CardHeader>
      <CardTitle>Visibility &amp; embed</CardTitle>
      <CardDescription>
        How this agent is reachable from the outside. Public agents on
        whitelisted origins can be embedded with no token; private agents
        require a JWT minted by your backend.
        <a
          href="https://bridle.cleanslice.org/embed/script-tag"
          target="_blank"
          rel="noopener"
          class="underline"
        >Docs ↗</a>
      </CardDescription>
    </CardHeader>
    <CardContent class="grid gap-4">
      <div
        v-if="needsLimits"
        class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        role="status"
        data-limits-needed
      >
        <IconAlertTriangle class="mt-0.5 size-4 shrink-0" />
        <p>
          <span class="font-medium">Public without limits.</span>
          This agent was made public before request limits existed and still
          answers without a cap. Set at least one limit below — the next save
          of these settings requires it.
        </p>
      </div>

      <form class="grid gap-4" novalidate @submit.prevent="onSave">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <Label :for="`visibility-public-${agentId}`">Public</Label>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ form.isPublic
                ? 'Listed on the landing page; visitors on an allowed origin chat with no token. A public agent needs at least one request limit.'
                : 'Hidden from the landing page; a token is required from any origin.' }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <!-- What is SAVED, next to what the switch proposes: after a
                 refused save the switch still says "public" and this still
                 says "Private". -->
            <Badge
              :variant="isPublic ? 'default' : 'outline'"
              :data-visibility-saved="isPublic ? 'public' : 'private'"
              :title="isPublic ? 'Saved as public' : 'Saved as private'"
            >
              {{ isPublic ? 'Public' : 'Private' }}
            </Badge>
            <Switch
              :id="`visibility-public-${agentId}`"
              v-model="form.isPublic"
              :disabled="submitting"
              data-visibility-public
            />
          </div>
        </div>

        <div class="grid gap-2">
          <Label :for="`visibility-origins-${agentId}`">Allowed origins</Label>
          <Textarea
            :id="`visibility-origins-${agentId}`"
            v-model="form.originsText"
            rows="3"
            placeholder="https://example.com&#10;http://localhost:5173"
            :disabled="submitting"
            data-visibility-origins
          />
          <p class="text-xs text-muted-foreground">
            One origin per line (scheme + host + optional port, no path). Browser sites
            at these origins can open chat WebSockets without a JWT when the agent
            is public. Leave empty to require a token from every origin.
          </p>
        </div>

        <fieldset class="grid gap-2">
          <legend class="text-sm font-medium leading-none">
            Request limits
            <span class="ml-1 text-xs font-normal text-muted-foreground">
              {{ form.isPublic ? 'at least one is required while the agent is public' : 'optional' }}
            </span>
          </legend>
          <p class="text-xs text-muted-foreground">
            How many requests this agent accepts from everyone together — one
            allowance shared by all visitors. An empty field means that window
            is not limited; all three empty switches limits off.
          </p>

          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="field in LIMIT_FIELDS" :key="field.window" class="grid content-start gap-1.5">
              <Label
                :for="`limit-${field.window}-${agentId}`"
                class="text-xs text-muted-foreground"
              >
                Requests {{ field.label }}
              </Label>
              <Input
                :id="`limit-${field.window}-${agentId}`"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="Not limited"
                :model-value="form[field.window]"
                :disabled="submitting || !limitsKnown"
                :aria-invalid="problem?.place === field.window ? 'true' : undefined"
                :aria-describedby="problem?.place === field.window ? `limit-${field.window}-${agentId}-error` : undefined"
                :data-limit-input="field.window"
                @update:model-value="(v: string | number) => setLimitText(field.window, v)"
              />
              <p
                v-if="peakOf(field.window) > 0"
                class="text-xs text-muted-foreground"
                :title="PEAK_TITLES[field.window]"
                :data-limit-peak="field.window"
              >
                highest seen: {{ formatNumber(peakOf(field.window)) }}
              </p>
              <p
                v-if="problem?.place === field.window"
                :id="`limit-${field.window}-${agentId}-error`"
                class="text-xs text-destructive"
                role="alert"
                data-limits-error
                :data-limits-error-code="problem.code"
              >
                {{ problem.text }}
              </p>
            </div>
          </div>

          <p
            v-if="problem?.place === 'limits'"
            class="text-xs text-destructive"
            role="alert"
            data-limits-error
            :data-limits-error-code="problem.code"
          >
            {{ problem.text }}
          </p>

          <p v-if="limitsLoadError" class="text-xs text-destructive">
            {{ limitsLoadError }} — the limits cannot be edited until they load.
            <button type="button" class="underline" @click="loadLimits">Retry</button>
          </p>

          <p class="text-xs text-muted-foreground" data-limits-uncovered>
            Limits do not cover: operators (Owners and Admins, from either
            console), agent-to-agent requests, Telegram, and the agent's
            scheduled runs.
          </p>

          <div
            v-if="showShareWarning"
            class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
            role="status"
            data-limits-share-warning
          >
            <IconAlertTriangle class="mt-0.5 size-4 shrink-0" />
            <p>
              This agent is private, but it has an active share link and no
              limits: anyone with the link can use it without a cap. You can
              save it this way.
            </p>
          </div>
        </fieldset>

        <p
          v-if="saveError"
          class="text-xs text-destructive"
          role="alert"
          data-visibility-error
        >
          {{ saveError }}
        </p>

        <div class="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            :disabled="submitting || !dirty || !limitsKnown"
            data-visibility-save
          >
            <IconLoader2 v-if="submitting" class="size-4 animate-spin" />
            <IconCheck v-else class="size-4" />
            {{ submitting ? 'Saving…' : 'Save' }}
          </Button>
          <Button
            v-if="dirty"
            type="button"
            variant="ghost"
            size="sm"
            :disabled="submitting"
            @click="resetForm"
          >
            <IconX class="size-4" />
            Cancel
          </Button>
          <span
            v-if="justSaved && !dirty"
            class="text-xs text-muted-foreground"
            role="status"
            data-visibility-saved-note
          >
            Saved
          </span>
        </div>
      </form>

      <div class="grid gap-3">
        <div>
          <div class="flex items-center justify-between gap-2">
            <Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Floating bubble
            </Label>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="copy('floating', embedFloating)"
            >
              <IconCheck v-if="copiedKey === 'floating'" class="size-3.5" />
              <IconCopy v-else class="size-3.5" />
              {{ copiedKey === 'floating' ? 'Copied' : 'Copy' }}
            </Button>
          </div>
          <pre
            class="mt-1 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
          >{{ embedFloating }}</pre>
        </div>

        <div>
          <div class="flex items-center justify-between gap-2">
            <Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Inline (mounted in your container)
            </Label>
            <Button
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="copy('inline', embedInline)"
            >
              <IconCheck v-if="copiedKey === 'inline'" class="size-3.5" />
              <IconCopy v-else class="size-3.5" />
              {{ copiedKey === 'inline' ? 'Copied' : 'Copy' }}
            </Button>
          </div>
          <pre
            class="mt-1 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
          >{{ embedInline }}</pre>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between gap-2">
          <Label class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Mint a browser token (server-side)
          </Label>
          <Button
            variant="ghost"
            size="sm"
            class="h-7 px-2 text-xs"
            @click="copy('mint', mintTokenCurl)"
          >
            <IconCheck v-if="copiedKey === 'mint'" class="size-3.5" />
            <IconCopy v-else class="size-3.5" />
            {{ copiedKey === 'mint' ? 'Copied' : 'Copy' }}
          </Button>
        </div>
        <pre
          class="mt-1 overflow-x-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
        >{{ mintTokenCurl }}</pre>
        <p class="mt-2 text-xs text-muted-foreground">
          Call this from your backend to mint the JWT used in
          <code class="font-mono">data-token</code>. Auth is a Ranch API key
          with the <code class="font-mono">embed:mint</code> scope —
          create one under
          <NuxtLink to="/api-keys" class="underline">API Keys</NuxtLink>.
          <code class="font-mono">sub</code> becomes the visitor's
          <code class="font-mono">clientId</code> (and transcript bucket).
          <code class="font-mono">expiresIn</code> is optional: defaults to
          <code class="font-mono">15m</code>, accepts
          <code class="font-mono">{{ '<n>(s|m|h|d)' }}</code> e.g.
          <code class="font-mono">24h</code>, <code class="font-mono">7d</code>,
          <code class="font-mono">30d</code>. Refresh transparently by
          passing a token-getter to the SDK
          (<code class="font-mono">token: () =&gt; fetchJwt()</code>) instead
          of pinning a long-lived JWT in the page.
          With an <code class="font-mono">embed:mint-admin</code> scoped key the
          same call may pass <code class="font-mono">"roles":["Owner"]</code> to
          mint <em>admin</em> tokens (TTL capped at 7d) — pair it with a
          token-getter for a permanent admin embed on a private page.
        </p>
      </div>

      <p class="text-xs text-muted-foreground">
        CSP reminder: allow
        <code class="font-mono">{{ apiUrl }}</code> in
        <code class="font-mono">connect-src</code> and the SDK origin in
        <code class="font-mono">script-src</code>.
      </p>
    </CardContent>
  </Card>
</template>
