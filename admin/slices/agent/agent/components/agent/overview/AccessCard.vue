<script setup lang="ts">
/**
 * Access (CLEAN-228, User Story 5): who can reach this agent from outside
 * the admin — the landing-page switch, the allowed origins, and the embed
 * code folded away until asked for. Nothing about access is shown anywhere
 * else on Overview.
 *
 * The switch and the origins are fields of the page's draft, saved by the
 * page's bar together with the limits a public agent must have. The snippets
 * are built from what is SAVED: a snippet for a state that is not saved yet
 * would not work when pasted.
 */
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconExternalLink,
} from '@tabler/icons-vue'
import { useInjectedAgentDraft } from '#agent/composables/useAgentDraft'

const props = defineProps<{
  agentId: string
  apiUrl: string
}>()

const draft = useInjectedAgentDraft()
const { errors, saving } = draft

const agentStore = useAgentStore()
const shareStore = useShareStore()

const agent = computed(() => agentStore.byId(props.agentId))
const savedPublic = computed(() => agent.value?.isPublic === true)
const uid = useId()

const limitsEmpty = computed(
  () =>
    draft.value('perMinute') === null &&
    draft.value('perHour') === null &&
    draft.value('perDay') === null,
)

// A private agent is not closed to someone holding its share link (CLEAN-224,
// FR-007): warn while the draft says "private, no limits" and a link is
// active. Read from the share store — the same record the header's Share menu
// shows.
const shareActive = computed(
  () => shareStore.linkFor(props.agentId)?.active === true,
)
const showShareWarning = computed(
  () => !draft.value('isPublic') && shareActive.value && limitsEmpty.value,
)

onMounted(() => {
  if (!shareStore.linkFor(props.agentId)) void shareStore.loadLink(props.agentId)
})

function goToLimits() {
  document.getElementById('visibility-embed')?.scrollIntoView({ block: 'start' })
}

// ── Embed code ───────────────────────────────────────────────────────
const SDK_URL = 'https://bridle.cleanslice.org/sdk/latest.js'

// For public agents whose origin matches the whitelist the hub accepts the WS
// without a JWT (see bridleClientWs.handler), so the snippet can omit
// `data-token` entirely. Private agents always need a server-minted token.
const embedFloating = computed(
  () => `<script
  src="${SDK_URL}"
  data-api-url="${props.apiUrl}"
  data-agent-id="${props.agentId}"${savedPublic.value ? '' : '\n  data-token="<JWT minted by your backend>"'}
><\/script>`,
)

const embedInline = computed(
  () => `<div id="bridle-chat" style="height: 600px; max-width: 480px;"></div>
<script
  src="${SDK_URL}"
  data-api-url="${props.apiUrl}"
  data-agent-id="${props.agentId}"
  data-mode="inline"
  data-mount="#bridle-chat"${savedPublic.value ? '' : '\n  data-token="<JWT minted by your backend>"'}
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

type EmbedKind = 'bubble' | 'inline' | 'token'

const EMBED_KINDS: ReadonlyArray<{ kind: EmbedKind; label: string; help: string }> = [
  {
    kind: 'bubble',
    label: 'Floating bubble',
    help: 'Adds a chat bubble in the corner of the page.',
  },
  {
    kind: 'inline',
    label: 'Inline',
    help: 'Mounts the chat inside your own container.',
  },
  {
    kind: 'token',
    label: 'Mint a token',
    help: 'Run on your backend with an API key that has the embed:mint scope. expiresIn defaults to 15m.',
  },
]

const embedKind = ref<EmbedKind>('bubble')
const embedCode = computed(() => {
  if (embedKind.value === 'inline') return embedInline.value
  if (embedKind.value === 'token') return mintTokenCurl.value
  return embedFloating.value
})
const embedHelp = computed(
  () => EMBED_KINDS.find((k) => k.kind === embedKind.value)?.help ?? '',
)

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
async function copy() {
  try {
    await navigator.clipboard.writeText(embedCode.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    // Clipboard write fails silently in restricted contexts (e.g. iframes
    // without permission) — surfacing an error toast is more noise than help.
  }
}
watch(embedKind, () => {
  copied.value = false
})
onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

const CALM_SWITCH =
  'motion-reduce:transition-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none'
</script>

<template>
  <section v-if="agent" class="rounded-xl border bg-card" data-block="access">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 pt-4">
      <h2 class="text-[15px] font-semibold">Access</h2>
      <p class="basis-full text-[13px] text-muted-foreground">
        Who can reach this agent from outside the admin.
      </p>
    </header>

    <div class="px-5 pb-2 pt-1.5">
      <AgentOverviewRow label="Landing page" :for="`${uid}-public`">
        <div class="flex min-h-[34px] flex-wrap items-center gap-x-2.5 gap-y-1 text-[13.5px]">
          <Switch
            :id="`${uid}-public`"
            :model-value="draft.value('isPublic')"
            :disabled="saving"
            :aria-describedby="`${uid}-public-state`"
            :class="[CALM_SWITCH, draft.changed('isPublic') && 'ring-2 ring-amber-500/45']"
            data-visibility-public
            :data-changed="draft.changed('isPublic') ? '' : undefined"
            @update:model-value="(v: boolean) => draft.set('isPublic', v)"
          />
          <span :id="`${uid}-public-state`">
            {{ draft.value('isPublic')
              ? 'Public. Listed on the landing page.'
              : 'Private. Hidden from the public agent list.' }}
          </span>
          <!-- What is SAVED, next to what the switch proposes: after a
               refused save the switch still says "public" and this still
               says private. Read aloud always, shown only while they differ. -->
          <span
            :class="draft.changed('isPublic') ? 'text-xs text-muted-foreground' : 'sr-only'"
            :data-visibility-saved="savedPublic ? 'public' : 'private'"
          >
            {{ savedPublic ? 'Saved as public.' : 'Saved as private.' }}
          </span>
        </div>
        <p
          v-if="draft.value('isPublic')"
          class="text-xs text-muted-foreground"
        >
          Visitors on an allowed origin chat with no token. A public agent
          needs at least one request limit.
        </p>
        <p
          v-if="errors.isPublic"
          class="text-xs text-destructive"
          role="alert"
          data-field-error="isPublic"
        >
          {{ errors.isPublic.text }}
          Limits are set in the
          <button type="button" class="underline underline-offset-2" @click="goToLimits">
            Request limit block
          </button>
          above.
        </p>
      </AgentOverviewRow>

      <AgentOverviewRow label="Allowed origins" :for="`${uid}-origins`">
        <template #hint>Embed without a token</template>
        <AgentAccessOriginsInput
          :id="`${uid}-origins`"
          :model-value="draft.value('allowedOrigins')"
          :disabled="saving"
          :changed="draft.changed('allowedOrigins')"
          @update:model-value="(v: string[]) => draft.set('allowedOrigins', v)"
        />
        <div
          v-if="showShareWarning"
          class="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900"
          role="status"
          data-limits-share-warning
        >
          <IconAlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            This agent is private, but it has an active share link and no
            limits: anyone with the link can use it without a cap. You can
            save it this way.
          </p>
        </div>
      </AgentOverviewRow>
    </div>

    <!-- Closed until asked for: three always-open code samples were most of
         the old card's height. -->
    <Accordion type="single" collapsible class="border-t">
      <AccordionItem value="embed" class="border-b-0" data-embed>
        <AccordionTrigger
          class="items-center rounded-none px-5 py-3.5 text-[13.5px] hover:no-underline motion-reduce:transition-none [&>svg]:motion-reduce:transition-none"
        >
          <span class="flex items-center gap-2">
            <IconExternalLink class="size-4" aria-hidden="true" />
            Embed code
          </span>
          <template #icon>
            <IconChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform" aria-hidden="true" />
          </template>
        </AccordionTrigger>
        <AccordionContent class="flex flex-col gap-2.5 px-5 pb-[18px]">
          <div
            class="inline-flex max-w-full flex-wrap gap-0.5 self-start rounded-[9px] bg-muted p-[3px]"
            role="group"
            aria-label="Embed type"
          >
            <button
              v-for="k in EMBED_KINDS"
              :key="k.kind"
              type="button"
              class="min-h-7 rounded-[7px] px-2.5 text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              :class="embedKind === k.kind
                ? 'bg-background font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="embedKind === k.kind"
              :data-embed-kind="k.kind"
              @click="embedKind = k.kind"
            >
              {{ k.label }}
            </button>
          </div>

          <div class="relative min-w-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="absolute right-2 top-2 h-7 bg-background px-2 text-xs"
              data-embed-copy
              @click="copy"
            >
              <IconCheck v-if="copied" class="size-3.5" aria-hidden="true" />
              <IconCopy v-else class="size-3.5" aria-hidden="true" />
              <span aria-live="polite">{{ copied ? 'Copied' : 'Copy' }}</span>
            </Button>
            <pre
              class="overflow-x-auto rounded-[10px] border bg-muted/40 p-3 pr-20 font-mono text-xs leading-relaxed"
              tabindex="0"
              :aria-label="`${EMBED_KINDS.find((k) => k.kind === embedKind)?.label} snippet`"
              data-embed-code
            >{{ embedCode }}</pre>
          </div>

          <p class="text-xs text-muted-foreground" data-embed-help>
            {{ embedHelp }}
            <template v-if="embedKind !== 'token'">
              {{ savedPublic
                ? 'This agent is public: on an allowed origin no token is needed.'
                : 'This agent is private: the page needs a token minted by your backend.' }}
            </template>
            <a
              href="https://bridle.cleanslice.org/embed/script-tag"
              target="_blank"
              rel="noopener"
              class="underline"
            >Docs ↗</a>
          </p>

          <details v-if="embedKind === 'token'" class="text-xs text-muted-foreground">
            <summary class="cursor-pointer select-none rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              Token options
            </summary>
            <p class="mt-2">
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
          </details>

          <p class="text-xs text-muted-foreground">
            CSP reminder: allow
            <code class="font-mono break-all">{{ apiUrl }}</code> in
            <code class="font-mono">connect-src</code> and the SDK origin in
            <code class="font-mono">script-src</code>.
          </p>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </section>
</template>
