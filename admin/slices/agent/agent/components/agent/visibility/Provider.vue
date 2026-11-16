<script setup lang="ts">
import type { LimitWindowTypes } from '#agent/domain/agentLimit.types'
import {
  provideAgentDraft,
  useOptionalAgentDraft,
  type IDraftError,
} from '#agent/composables/useAgentDraft'
import { LIMIT_FIELDS, limitTextToNumber } from '#agent/utils/agentLimitForm'
import { formatNumber } from '#common/utils/format'
import { IconAlertTriangle, IconCheck, IconCopy } from '@tabler/icons-vue'

const props = defineProps<{
  agentId: string
  apiUrl: string
  isPublic: boolean
  allowedOrigins: string[]
}>()

const limitStore = useAgentLimitStore()
const shareStore = useShareStore()

// ── The page's draft (CLEAN-228) ─────────────────────────────────────
// The switch, the origins and the three limits are fields of the Overview
// page's one draft: they are read from it and written to it, and the page's
// save bar saves them with everything else. This card has no Save of its own.
//
// Mounted somewhere that provides no draft (the Edit page, until it is
// retired), the card makes one for itself and shows the bar inside.
const pageDraft = useOptionalAgentDraft()
const standalone = pageDraft === null
const draft = pageDraft ?? provideAgentDraft(() => props.agentId)
const { errors, saving, limitsKnown } = draft

// ── What is saved ────────────────────────────────────────────────────
// The public flag and the origins are the agent record's (props, fed by the
// agent store); the limits, the 30-day peaks and the "public without limits"
// flag are the limit store's record for this agent (docs/state.md). Nothing
// here keeps a copy of either — the only local state below is the TEXT being
// typed into a field, kept while it still says what the draft holds.
const limitEntry = computed(() => limitStore.byAgent[props.agentId])
// `undefined`: not read yet. `null`: read, and limits are off.
const savedLimits = computed(() => limitEntry.value?.limits)
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

// ── The fields ───────────────────────────────────────────────────────
// A text field cannot be driven by the draft's value alone: "20 " and "20"
// are the same limit, and a line break at the end of the origins is the same
// list — re-rendering the parsed value would eat what is being typed. So each
// field remembers its own text, and shows it for as long as it still parses to
// what the draft holds. After a discard, a save or a change from elsewhere it
// no longer does, and the field shows the draft again.

function parseOrigins(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

const typedOrigins = ref<string | null>(null)

const originsText = computed(() => {
  const held = draft.value('allowedOrigins').join('\n')
  if (
    typedOrigins.value !== null &&
    parseOrigins(typedOrigins.value).join('\n') === held
  ) {
    return typedOrigins.value
  }
  return held
})

function setOriginsText(value: string | number) {
  typedOrigins.value = String(value ?? '')
  draft.set('allowedOrigins', parseOrigins(typedOrigins.value))
}

const typedLimits = reactive<Record<LimitWindowTypes, string | null>>({
  minute: null,
  hour: null,
  day: null,
})

function limitText(field: (typeof LIMIT_FIELDS)[number]): string {
  const held = draft.value(field.key)
  const typed = typedLimits[field.window]
  // `Object.is`: text that is not a number is held as NaN, and stays shown.
  if (typed !== null && Object.is(limitTextToNumber(typed), held)) return typed
  return held === null || Number.isNaN(held) ? '' : String(held)
}

function setLimitText(
  field: (typeof LIMIT_FIELDS)[number],
  value: string | number,
) {
  typedLimits[field.window] = String(value ?? '')
  draft.set(field.key, limitTextToNumber(typedLimits[field.window] ?? ''))
}

const limitsEmpty = computed(
  () =>
    draft.value('perMinute') === null &&
    draft.value('perHour') === null &&
    draft.value('perDay') === null,
)

// A refused save, by the field it concerns (`draft.errors`).
function limitError(field: (typeof LIMIT_FIELDS)[number]): IDraftError | null {
  return errors.value[field.key] ?? null
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
// warn while the draft says "private, no limits" and a link is active. Read
// from the share store — the same record the header's Share menu shows.
const shareActive = computed(
  () => shareStore.linkFor(props.agentId)?.active === true,
)
const showShareWarning = computed(
  () => !draft.value('isPublic') && shareActive.value && limitsEmpty.value,
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

      <!-- No Save here: these fields are part of the page's draft, saved by
           the page's bar. Enter in a field saves the page, as it used to. -->
      <form class="grid gap-4" novalidate @submit.prevent="draft.save()">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <Label :for="`visibility-public-${agentId}`">Public</Label>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ draft.value('isPublic')
                ? 'Listed on the landing page; visitors on an allowed origin chat with no token. A public agent needs at least one request limit.'
                : 'Hidden from the landing page; a token is required from any origin.' }}
            </p>
            <p
              v-if="errors.isPublic"
              class="mt-1 text-xs text-destructive"
              role="alert"
              data-field-error="isPublic"
            >
              {{ errors.isPublic.text }}
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
              :model-value="draft.value('isPublic')"
              :disabled="saving"
              :data-changed="draft.changed('isPublic') ? '' : undefined"
              data-visibility-public
              @update:model-value="(v: boolean) => draft.set('isPublic', v)"
            />
          </div>
        </div>

        <div class="grid gap-2">
          <Label :for="`visibility-origins-${agentId}`">Allowed origins</Label>
          <Textarea
            :id="`visibility-origins-${agentId}`"
            :model-value="originsText"
            rows="3"
            placeholder="https://example.com&#10;http://localhost:5173"
            :disabled="saving"
            :data-changed="draft.changed('allowedOrigins') ? '' : undefined"
            data-visibility-origins
            @update:model-value="setOriginsText"
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
              {{ draft.value('isPublic') ? 'at least one is required while the agent is public' : 'optional' }}
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
                :model-value="limitText(field)"
                :disabled="saving || !limitsKnown"
                :aria-invalid="limitError(field) ? 'true' : undefined"
                :aria-describedby="limitError(field) ? `limit-${field.window}-${agentId}-error` : undefined"
                :data-changed="draft.changed(field.key) ? '' : undefined"
                :data-limit-input="field.window"
                @update:model-value="(v: string | number) => setLimitText(field, v)"
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
                v-if="limitError(field)"
                :id="`limit-${field.window}-${agentId}-error`"
                class="text-xs text-destructive"
                role="alert"
                data-limits-error
                :data-limits-error-code="limitError(field)?.code ?? ''"
              >
                {{ limitError(field)?.text }}
              </p>
            </div>
          </div>

          <p
            v-if="errors.limits"
            class="text-xs text-destructive"
            role="alert"
            data-limits-error
            :data-limits-error-code="errors.limits.code ?? ''"
          >
            {{ errors.limits.text }}
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

      </form>

      <!-- Only where no page provides the draft and its bar (the Edit page). -->
      <AgentOverviewSaveBar v-if="standalone" />

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
