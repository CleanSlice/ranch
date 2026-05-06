<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { IBridleDebugData } from '../../stores/bridle'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#theme/components/ui/tabs'
import { Badge } from '#theme/components/ui/badge'
import { Button } from '#theme/components/ui/button'
import { Input } from '#theme/components/ui/input'
import { Separator } from '#theme/components/ui/separator'
import { Bug, Check, Copy, Search, X } from 'lucide-vue-next'
import { cn } from '#theme/utils/cn'

const props = defineProps<{
  open: boolean
  debug: IBridleDebugData | null
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

const query = ref('')
const tab = ref<'prompt' | 'response' | 'usage'>('prompt')
const copiedKey = ref<string | null>(null)

watch(
  () => props.open,
  (next) => {
    if (next) {
      query.value = ''
      tab.value = 'prompt'
    }
  },
)

async function copyText(key: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, 1500)
  } catch (err) {
    console.warn('[bridle-debug] clipboard failed', err)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlight(text: string, q: string): string {
  const safe = escapeHtml(text)
  if (!q) return safe
  const re = new RegExp(escapeRegex(q), 'gi')
  return safe.replace(
    re,
    (m) =>
      `<mark class="bg-yellow-200 dark:bg-yellow-500/40 text-foreground rounded-sm px-0.5">${m}</mark>`,
  )
}

function countMatches(text: string, q: string): number {
  if (!q) return 0
  const re = new RegExp(escapeRegex(q), 'gi')
  return (text.match(re) ?? []).length
}

const historyJson = computed(() =>
  props.debug ? JSON.stringify(props.debug.history, null, 2) : '',
)

const toolCallsJson = computed(() =>
  props.debug?.response.toolCalls
    ? JSON.stringify(props.debug.response.toolCalls, null, 2)
    : '',
)

interface ParsedEvent {
  id: string
  type: string
  ts: number
  data: Record<string, unknown>
  raw: string
}

const parsedHistory = computed<ParsedEvent[]>(() => {
  if (!props.debug?.history) return []
  return props.debug.history.map((evt) => {
    const e = (evt ?? {}) as Record<string, unknown>
    return {
      id: String(e.id ?? ''),
      type: String(e.type ?? 'unknown'),
      ts: Number(e.ts ?? 0),
      data: (e.data ?? {}) as Record<string, unknown>,
      raw: JSON.stringify(evt, null, 2),
    }
  })
})

const filteredHistory = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return parsedHistory.value
  return parsedHistory.value.filter((e) => e.raw.toLowerCase().includes(q))
})

const promptMatches = computed(() => {
  const q = query.value.trim()
  if (!q || !props.debug) return 0
  return countMatches(props.debug.systemPrompt, q)
})

const historyMatchCount = computed(() => filteredHistory.value.length)

const responseMatches = computed(() => {
  const q = query.value.trim()
  if (!q || !props.debug) return 0
  let n = countMatches(props.debug.response.text ?? '', q)
  if (props.debug.response.toolCalls) {
    n += countMatches(toolCallsJson.value, q)
  }
  return n
})

const totalMatches = computed(() => {
  if (!query.value.trim()) return 0
  return promptMatches.value + historyMatchCount.value + responseMatches.value
})

const eventTypeStyle: Record<string, string> = {
  user: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30',
  assistant: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  tool_call: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/30',
  tool_result: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30',
  system: 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 border-zinc-500/30',
  summary: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30',
}

function eventBadgeClass(type: string): string {
  return eventTypeStyle[type] ?? 'bg-muted text-foreground border-border'
}

function fmtTime(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false })
}

function eventHeadline(evt: ParsedEvent): string {
  const d = evt.data as Record<string, unknown>
  if (evt.type === 'user' || evt.type === 'assistant' || evt.type === 'system') {
    return String(d.text ?? '')
  }
  if (evt.type === 'summary') {
    return String(d.text ?? '')
  }
  if (evt.type === 'tool_call') {
    return String(d.name ?? 'unknown')
  }
  if (evt.type === 'tool_result') {
    const result = d.result
    if (typeof result === 'string') return result
    if (result && typeof result === 'object' && 'error' in result) {
      return `error: ${String((result as { error: unknown }).error)}`
    }
    return ''
  }
  return ''
}

function eventBodyJson(evt: ParsedEvent): string {
  const d = evt.data as Record<string, unknown>
  if (evt.type === 'tool_call') {
    return d.params ? JSON.stringify(d.params, null, 2) : ''
  }
  if (evt.type === 'tool_result') {
    return d.result !== undefined ? JSON.stringify(d.result, null, 2) : ''
  }
  return ''
}

function clearQuery() {
  query.value = ''
}
</script>

<template>
  <Sheet :open="open" @update:open="$emit('update:open', $event)">
    <SheetContent
      side="right"
      class="w-full sm:max-w-2xl p-0 flex flex-col gap-0"
    >
      <!-- Sticky header -->
      <SheetHeader class="px-6 pt-6 pb-4 border-b bg-background/95 backdrop-blur sticky top-0 z-10">
        <div class="flex items-center gap-2">
          <Bug class="h-4 w-4 text-muted-foreground" />
          <SheetTitle class="text-base">Prompt debug</SheetTitle>
        </div>
        <SheetDescription v-if="debug" class="flex items-center gap-2 text-xs">
          <Badge variant="secondary" class="font-mono">
            {{ debug.provider }} / {{ debug.model }}
          </Badge>
          <Badge variant="outline" class="font-mono">{{ debug.latencyMs }}ms</Badge>
          <span v-if="debug.usage" class="text-muted-foreground">
            {{ debug.usage.totalTokens.toLocaleString() }} tokens
          </span>
        </SheetDescription>
        <SheetDescription v-else class="text-xs text-muted-foreground">
          No debug data captured for this message.
        </SheetDescription>
      </SheetHeader>

      <!-- Search bar -->
      <div
        v-if="debug"
        class="px-6 py-3 border-b bg-background sticky top-[88px] z-10"
      >
        <div class="relative">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            v-model="query"
            placeholder="Search across prompt, history, response…"
            class="pl-9 pr-20 h-9 text-sm"
          />
          <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <span
              v-if="query"
              class="text-xs text-muted-foreground tabular-nums"
            >
              {{ totalMatches }}
            </span>
            <button
              v-if="query"
              type="button"
              class="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
              @click="clearQuery"
            >
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <!-- Tabs body -->
      <div v-if="debug" class="flex-1 min-h-0 overflow-y-auto">
        <Tabs v-model="tab" class="w-full">
          <TabsList class="sticky top-0 z-10 grid w-full grid-cols-3 rounded-none border-b bg-background h-11">
            <TabsTrigger value="prompt" class="gap-1.5 cursor-pointer transition-colors hover:bg-muted/60 hover:text-foreground data-[state=active]:hover:bg-background">
              Prompt
              <span
                v-if="query && (promptMatches + historyMatchCount) > 0"
                class="text-[10px] font-normal text-muted-foreground tabular-nums"
              >
                ({{ promptMatches + historyMatchCount }})
              </span>
            </TabsTrigger>
            <TabsTrigger value="response" class="gap-1.5 cursor-pointer transition-colors hover:bg-muted/60 hover:text-foreground data-[state=active]:hover:bg-background">
              Response
              <span
                v-if="query && responseMatches > 0"
                class="text-[10px] font-normal text-muted-foreground tabular-nums"
              >
                ({{ responseMatches }})
              </span>
            </TabsTrigger>
            <TabsTrigger value="usage" class="cursor-pointer transition-colors hover:bg-muted/60 hover:text-foreground data-[state=active]:hover:bg-background">
              Usage
            </TabsTrigger>
          </TabsList>

          <!-- Prompt -->
          <TabsContent value="prompt" class="px-6 py-5 space-y-6 m-0">
            <section>
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-semibold">System prompt</h4>
                  <span
                    v-if="query && promptMatches > 0"
                    class="text-xs text-muted-foreground tabular-nums"
                  >
                    {{ promptMatches }} match{{ promptMatches === 1 ? '' : 'es' }}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="copyText('system', debug.systemPrompt)"
                >
                  <Check v-if="copiedKey === 'system'" class="h-3 w-3" />
                  <Copy v-else class="h-3 w-3" />
                  <span class="ml-1">{{ copiedKey === 'system' ? 'Copied' : 'Copy' }}</span>
                </Button>
              </div>
              <pre
                class="text-xs leading-relaxed bg-muted/60 rounded-md p-3 whitespace-pre-wrap break-words max-h-80 overflow-y-auto border font-mono"
                v-html="highlight(debug.systemPrompt, query)"
              />
            </section>

            <Separator />

            <section>
              <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-semibold">History</h4>
                  <Badge variant="secondary" class="font-mono">
                    {{ filteredHistory.length }}<span v-if="query && filteredHistory.length !== parsedHistory.length"> / {{ parsedHistory.length }}</span>
                  </Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="copyText('history', historyJson)"
                >
                  <Check v-if="copiedKey === 'history'" class="h-3 w-3" />
                  <Copy v-else class="h-3 w-3" />
                  <span class="ml-1">{{ copiedKey === 'history' ? 'Copied' : 'Copy raw' }}</span>
                </Button>
              </div>

              <div v-if="filteredHistory.length === 0" class="text-xs text-muted-foreground italic py-6 text-center">
                No events match "{{ query }}"
              </div>

              <ul v-else class="space-y-2">
                <li
                  v-for="evt in filteredHistory"
                  :key="evt.id || `${evt.type}-${evt.ts}`"
                  class="rounded-md border bg-card overflow-hidden"
                >
                  <div class="flex items-center justify-between gap-2 px-3 py-2 bg-muted/30 border-b">
                    <div class="flex items-center gap-2 min-w-0">
                      <span
                        :class="cn(
                          'inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide',
                          eventBadgeClass(evt.type),
                        )"
                      >
                        {{ evt.type }}
                      </span>
                      <span class="text-[10px] text-muted-foreground font-mono tabular-nums">
                        {{ fmtTime(evt.ts) }}
                      </span>
                      <span
                        v-if="evt.id"
                        class="text-[10px] text-muted-foreground/60 font-mono truncate"
                        :title="evt.id"
                      >
                        {{ evt.id.slice(0, 8) }}
                      </span>
                    </div>
                  </div>
                  <div class="px-3 py-2 space-y-1.5">
                    <p
                      v-if="eventHeadline(evt)"
                      class="text-xs whitespace-pre-wrap break-words leading-relaxed"
                      v-html="highlight(eventHeadline(evt), query)"
                    />
                    <pre
                      v-if="eventBodyJson(evt)"
                      class="text-[11px] bg-muted/40 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono"
                      v-html="highlight(eventBodyJson(evt), query)"
                    />
                  </div>
                </li>
              </ul>
            </section>
          </TabsContent>

          <!-- Response -->
          <TabsContent value="response" class="px-6 py-5 space-y-6 m-0">
            <section>
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-sm font-semibold">Text</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  :disabled="!debug.response.text"
                  @click="copyText('text', debug.response.text)"
                >
                  <Check v-if="copiedKey === 'text'" class="h-3 w-3" />
                  <Copy v-else class="h-3 w-3" />
                  <span class="ml-1">{{ copiedKey === 'text' ? 'Copied' : 'Copy' }}</span>
                </Button>
              </div>
              <pre
                v-if="debug.response.text"
                class="text-xs leading-relaxed bg-muted/60 rounded-md p-3 whitespace-pre-wrap break-words max-h-80 overflow-y-auto border"
                v-html="highlight(debug.response.text, query)"
              />
              <p v-else class="text-xs text-muted-foreground italic">— empty —</p>
            </section>

            <section v-if="debug.response.toolCalls && debug.response.toolCalls.length">
              <Separator class="mb-4" />
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-semibold">Tool calls</h4>
                  <Badge variant="secondary" class="font-mono">{{ debug.response.toolCalls.length }}</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="copyText('tools', toolCallsJson)"
                >
                  <Check v-if="copiedKey === 'tools'" class="h-3 w-3" />
                  <Copy v-else class="h-3 w-3" />
                  <span class="ml-1">{{ copiedKey === 'tools' ? 'Copied' : 'Copy' }}</span>
                </Button>
              </div>
              <pre
                class="text-xs bg-muted/60 rounded-md p-3 whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono border"
                v-html="highlight(toolCallsJson, query)"
              />
            </section>

            <section>
              <Separator class="mb-4" />
              <h4 class="text-sm font-semibold mb-2">Stop reason</h4>
              <Badge variant="outline" class="font-mono">
                {{ debug.response.stopReason ?? '—' }}
              </Badge>
            </section>
          </TabsContent>

          <!-- Usage -->
          <TabsContent value="usage" class="px-6 py-5 space-y-6 m-0">
            <section v-if="debug.usage">
              <h4 class="text-sm font-semibold mb-3">Tokens</h4>
              <div class="rounded-md border overflow-hidden">
                <table class="w-full text-sm">
                  <tbody>
                    <tr class="border-b">
                      <td class="py-2 px-3 text-muted-foreground">Input</td>
                      <td class="py-2 px-3 text-right font-mono tabular-nums">
                        {{ debug.usage.inputTokens.toLocaleString() }}
                      </td>
                    </tr>
                    <tr class="border-b">
                      <td class="py-2 px-3 text-muted-foreground">Output</td>
                      <td class="py-2 px-3 text-right font-mono tabular-nums">
                        {{ debug.usage.outputTokens.toLocaleString() }}
                      </td>
                    </tr>
                    <tr class="bg-muted/30">
                      <td class="py-2 px-3 font-semibold">Total</td>
                      <td class="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                        {{ debug.usage.totalTokens.toLocaleString() }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
            <p v-else class="text-xs text-muted-foreground italic">No usage data reported.</p>

            <section>
              <Separator class="mb-4" />
              <h4 class="text-sm font-semibold mb-3">Routing</h4>
              <dl class="text-sm space-y-2">
                <div class="flex justify-between items-center">
                  <dt class="text-muted-foreground">Provider</dt>
                  <dd>
                    <Badge variant="secondary" class="font-mono">{{ debug.provider }}</Badge>
                  </dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-muted-foreground">Model</dt>
                  <dd>
                    <Badge variant="secondary" class="font-mono">{{ debug.model }}</Badge>
                  </dd>
                </div>
                <div v-if="debug.usage?.credentialId" class="flex justify-between items-center">
                  <dt class="text-muted-foreground">Credential</dt>
                  <dd class="font-mono text-xs">{{ debug.usage.credentialId }}</dd>
                </div>
                <div class="flex justify-between items-center">
                  <dt class="text-muted-foreground">Latency</dt>
                  <dd class="font-mono tabular-nums">{{ debug.latencyMs }}ms</dd>
                </div>
              </dl>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </SheetContent>
  </Sheet>
</template>
