<script setup lang="ts">
import { computed, ref } from 'vue'
import type { IBridleDebugData } from '../../stores/bridle'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '#theme/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#theme/components/ui/tabs'
import { Button } from '#theme/components/ui/button'
import { Copy, Check } from 'lucide-vue-next'

const props = defineProps<{
  open: boolean
  debug: IBridleDebugData | null
}>()

defineEmits<{
  'update:open': [value: boolean]
}>()

const copiedKey = ref<string | null>(null)

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

const historyJson = computed(() =>
  props.debug ? JSON.stringify(props.debug.history, null, 2) : '',
)

const toolCallsJson = computed(() =>
  props.debug?.response.toolCalls
    ? JSON.stringify(props.debug.response.toolCalls, null, 2)
    : '',
)
</script>

<template>
  <Sheet :open="open" @update:open="$emit('update:open', $event)">
    <SheetContent side="right" class="w-full sm:max-w-2xl overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Prompt debug</SheetTitle>
        <SheetDescription v-if="debug">
          <span class="font-mono text-xs">{{ debug.provider }} / {{ debug.model }}</span>
          <span class="ml-3 text-xs text-muted-foreground">{{ debug.latencyMs }}ms</span>
        </SheetDescription>
        <SheetDescription v-else>No debug data captured for this message.</SheetDescription>
      </SheetHeader>

      <div v-if="debug" class="mt-6">
        <Tabs default-value="prompt" class="w-full">
          <TabsList class="grid w-full grid-cols-3">
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
            <TabsTrigger value="response">Response</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          <!-- Prompt: system + history -->
          <TabsContent value="prompt" class="space-y-4">
            <section>
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-sm font-semibold">System prompt</h4>
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
              <pre class="text-xs bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{{ debug.systemPrompt }}</pre>
            </section>

            <section>
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-sm font-semibold">History ({{ debug.history.length }} events)</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="copyText('history', historyJson)"
                >
                  <Check v-if="copiedKey === 'history'" class="h-3 w-3" />
                  <Copy v-else class="h-3 w-3" />
                  <span class="ml-1">{{ copiedKey === 'history' ? 'Copied' : 'Copy' }}</span>
                </Button>
              </div>
              <pre class="text-xs bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-96 overflow-y-auto font-mono">{{ historyJson }}</pre>
            </section>
          </TabsContent>

          <!-- Response: text + tool calls + stop reason -->
          <TabsContent value="response" class="space-y-4">
            <section>
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-sm font-semibold">Text</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 px-2 text-xs"
                  @click="copyText('text', debug.response.text)"
                >
                  <Check v-if="copiedKey === 'text'" class="h-3 w-3" />
                  <Copy v-else class="h-3 w-3" />
                  <span class="ml-1">{{ copiedKey === 'text' ? 'Copied' : 'Copy' }}</span>
                </Button>
              </div>
              <pre v-if="debug.response.text" class="text-xs bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-72 overflow-y-auto">{{ debug.response.text }}</pre>
              <p v-else class="text-xs text-muted-foreground italic">— empty —</p>
            </section>

            <section v-if="debug.response.toolCalls && debug.response.toolCalls.length">
              <div class="flex items-center justify-between mb-2">
                <h4 class="text-sm font-semibold">Tool calls ({{ debug.response.toolCalls.length }})</h4>
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
              <pre class="text-xs bg-muted rounded p-3 whitespace-pre-wrap break-words max-h-72 overflow-y-auto font-mono">{{ toolCallsJson }}</pre>
            </section>

            <section>
              <h4 class="text-sm font-semibold mb-2">Stop reason</h4>
              <code class="text-xs bg-muted rounded px-2 py-1">{{ debug.response.stopReason ?? '—' }}</code>
            </section>
          </TabsContent>

          <!-- Usage: tokens + credential -->
          <TabsContent value="usage" class="space-y-4">
            <section v-if="debug.usage">
              <h4 class="text-sm font-semibold mb-2">Tokens</h4>
              <table class="w-full text-sm">
                <tbody>
                  <tr class="border-b">
                    <td class="py-1.5 text-muted-foreground">Input</td>
                    <td class="py-1.5 text-right font-mono">{{ debug.usage.inputTokens.toLocaleString() }}</td>
                  </tr>
                  <tr class="border-b">
                    <td class="py-1.5 text-muted-foreground">Output</td>
                    <td class="py-1.5 text-right font-mono">{{ debug.usage.outputTokens.toLocaleString() }}</td>
                  </tr>
                  <tr>
                    <td class="py-1.5 font-semibold">Total</td>
                    <td class="py-1.5 text-right font-mono font-semibold">{{ debug.usage.totalTokens.toLocaleString() }}</td>
                  </tr>
                </tbody>
              </table>
            </section>
            <p v-else class="text-xs text-muted-foreground italic">No usage data reported.</p>

            <section>
              <h4 class="text-sm font-semibold mb-2">Routing</h4>
              <dl class="text-sm space-y-1">
                <div class="flex justify-between">
                  <dt class="text-muted-foreground">Provider</dt>
                  <dd class="font-mono">{{ debug.provider }}</dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted-foreground">Model</dt>
                  <dd class="font-mono">{{ debug.model }}</dd>
                </div>
                <div v-if="debug.usage?.credentialId" class="flex justify-between">
                  <dt class="text-muted-foreground">Credential</dt>
                  <dd class="font-mono">{{ debug.usage.credentialId }}</dd>
                </div>
                <div class="flex justify-between">
                  <dt class="text-muted-foreground">Latency</dt>
                  <dd class="font-mono">{{ debug.latencyMs }}ms</dd>
                </div>
              </dl>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </SheetContent>
  </Sheet>
</template>
