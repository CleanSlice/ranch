<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { IAgentData } from '#agent/stores/agent'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#theme/components/ui/card'
import { Badge } from '#theme/components/ui/badge'
import { Button } from '#theme/components/ui/button'
import { Label } from '#theme/components/ui/label'
import { Textarea } from '#theme/components/ui/textarea'
import {
  IconCheck,
  IconCopy,
  IconLoader2,
  IconPencil,
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

const editing = ref(false)
const submitting = ref(false)
const saveError = ref<string | null>(null)
const originsText = ref('')

watch(
  () => props.allowedOrigins,
  (next) => {
    if (!editing.value) originsText.value = next.join('\n')
  },
  { immediate: true },
)

function parseOrigins(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function startEdit() {
  originsText.value = props.allowedOrigins.join('\n')
  saveError.value = null
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  saveError.value = null
  originsText.value = props.allowedOrigins.join('\n')
}

async function saveOrigins() {
  if (submitting.value) return
  submitting.value = true
  saveError.value = null
  try {
    const updated = await agentStore.update(props.agentId, {
      allowedOrigins: parseOrigins(originsText.value),
    })
    agentStore.markPendingRestart(props.agentId)
    emit('saved', updated)
    editing.value = false
  } catch (err) {
    saveError.value = (err as Error).message || 'Save failed'
  } finally {
    submitting.value = false
  }
}

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
  <Card>
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
      <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt class="text-xs text-muted-foreground">Status</dt>
          <dd class="mt-1">
            <Badge :variant="isPublic ? 'default' : 'outline'">
              {{ isPublic ? 'Public' : 'Private' }}
            </Badge>
          </dd>
        </div>
        <div class="sm:col-span-2">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-xs text-muted-foreground">Allowed origins</dt>
            <Button
              v-if="!editing"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="startEdit"
            >
              <IconPencil class="size-3.5" />
              Edit
            </Button>
          </div>
          <dd class="mt-1 text-sm">
            <template v-if="!editing">
              <template v-if="allowedOrigins.length">
                <ul class="space-y-1 font-mono text-xs">
                  <li v-for="o in allowedOrigins" :key="o" class="break-all">{{ o }}</li>
                </ul>
              </template>
              <span v-else class="italic text-muted-foreground">
                {{ isPublic
                  ? 'None — public flag is on, but anonymous embed needs origins. Token still required.'
                  : 'None — token required from any origin.' }}
              </span>
            </template>
            <div v-else class="grid gap-2">
              <Textarea
                v-model="originsText"
                rows="4"
                placeholder="https://example.com&#10;http://localhost:5173"
                :disabled="submitting"
              />
              <p class="text-xs text-muted-foreground">
                One origin per line (scheme + host + optional port, no path). Browser sites
                at these origins can open chat WebSockets without a JWT. Leave empty to
                require a token from every origin.
              </p>
              <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>
              <div class="flex items-center gap-2">
                <Button size="sm" :disabled="submitting" @click="saveOrigins">
                  <IconLoader2 v-if="submitting" class="size-4 animate-spin" />
                  <IconCheck v-else class="size-4" />
                  {{ submitting ? 'Saving…' : 'Save' }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="submitting"
                  @click="cancelEdit"
                >
                  <IconX class="size-4" />
                  Cancel
                </Button>
              </div>
            </div>
          </dd>
        </div>
      </dl>

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

      <p class="text-xs text-muted-foreground">
        CSP reminder: allow
        <code class="font-mono">{{ apiUrl }}</code> in
        <code class="font-mono">connect-src</code> and the SDK origin in
        <code class="font-mono">script-src</code>.
      </p>
    </CardContent>
  </Card>
</template>
