<script setup lang="ts">
/**
 * Advanced (CLEAN-228, User Story 6): the rare and the risky, folded until
 * asked for — debug mode, the Ranch admin tools, identifiers.
 *
 * Debug mode is a field of the page's draft and is saved by the page's bar.
 * Promote and demote are not: each acts at once after its own confirmation,
 * as on the Edit page they came from. Demote used to run with no question at
 * all; it asks now, the same way promote does.
 */
import {
  IconChevronDown,
  IconLoader2,
  IconShield,
  IconShieldOff,
} from '@tabler/icons-vue'
import { useInjectedAgentDraft } from '#agent/composables/useAgentDraft'
import { useInjectedAgentMetrics } from '#agent/composables/useAgentMetrics'
import { formatBytes, usagePct } from '#agent/utils/agentFormat'
import { formatDateTime } from '#common/utils/format'

const props = defineProps<{ agentId: string }>()

const draft = useInjectedAgentDraft()
const { saving } = draft

const agentStore = useAgentStore()
const confirmStore = useConfirmStore()

const agent = computed(() => agentStore.byId(props.agentId))
const uid = useId()

// ── Promote / demote ─────────────────────────────────────────────────
const promoting = ref(false)
const promoteError = ref<string | null>(null)

async function onAdminAction() {
  const current = agent.value
  if (!current || promoting.value) return
  const demote = current.isAdmin
  const confirmed = await confirmStore.ask(
    demote
      ? {
          title: 'Demote from Ranch admin',
          description: `Remove the ranch_* tools from “${current.name}” and redeploy it without RANCH_ADMIN. No agent will have the admin tools until one is promoted.`,
          confirmLabel: 'Demote',
          variant: 'default',
        }
      : {
          title: 'Promote to Ranch admin',
          description: `Grant ranch_* tools to “${current.name}” and redeploy with RANCH_ADMIN=true. The flag is cleared from any other admin agent and that agent is also redeployed.`,
          confirmLabel: 'Promote',
          variant: 'default',
        },
  )
  if (!confirmed) return

  promoting.value = true
  promoteError.value = null
  try {
    if (demote) await agentStore.demoteAdmin(current.id)
    else await agentStore.promoteAdmin(current.id)
    // Both redeploy the agent; show it until the refetch confirms. No
    // rollback — the change itself has already succeeded.
    agentStore.patch(current.id, { status: 'deploying' })
    await agentStore.fetchById(current.id)
  } catch (err) {
    promoteError.value =
      (err as Error).message || (demote ? 'Demote failed' : 'Promote failed')
  } finally {
    promoting.value = false
  }
}

// ── Identifiers ──────────────────────────────────────────────────────
const { metrics, answered: metricsAnswered } = useInjectedAgentMetrics()

const nodeDisk = computed(() => {
  const node = metrics.value?.node
  if (!node) return null
  const used = node.diskCapacityBytes - node.diskAvailBytes
  return {
    name: node.name,
    text: `${formatBytes(used)} of ${formatBytes(node.diskCapacityBytes)} used (${usagePct(used, node.diskCapacityBytes)}%), ${formatBytes(node.diskAvailBytes)} free`,
  }
})

const CALM_SWITCH =
  'motion-reduce:transition-none motion-reduce:[&_[data-slot=switch-thumb]]:transition-none'
</script>

<template>
  <section v-if="agent" class="rounded-xl border bg-card" data-block="advanced">
    <Accordion type="single" collapsible>
      <AccordionItem value="advanced" class="border-b-0" data-advanced>
        <AccordionTrigger
          class="items-center rounded-xl px-5 py-3.5 text-[13.5px] hover:no-underline motion-reduce:transition-none"
        >
          <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="text-[15px] font-semibold">Advanced</span>
            <span class="text-[12.5px] font-normal text-muted-foreground">
              Debug mode, admin tools, identifiers
            </span>
            <!-- A change made in here must not hide when the block is folded. -->
            <span
              v-if="draft.changed('debugEnabled')"
              class="text-[12.5px] font-normal text-amber-800"
              data-advanced-changed
            >
              · 1 unsaved change inside
            </span>
          </span>
          <template #icon>
            <IconChevronDown
              class="size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none"
              aria-hidden="true"
            />
          </template>
        </AccordionTrigger>
        <AccordionContent class="px-5 pb-2">
          <AgentOverviewRow label="Debug mode" :for="`${uid}-debug`">
            <div class="flex min-h-[34px] items-center gap-2.5 text-[13.5px]">
              <Switch
                :id="`${uid}-debug`"
                :model-value="draft.value('debugEnabled')"
                :disabled="saving"
                :aria-describedby="`${uid}-debug-help`"
                :class="[CALM_SWITCH, draft.changed('debugEnabled') && 'ring-2 ring-amber-500/45']"
                data-field="debug"
                :data-changed="draft.changed('debugEnabled') ? '' : undefined"
                @update:model-value="(v: boolean) => draft.set('debugEnabled', v)"
              />
              <span>{{ draft.value('debugEnabled') ? 'On' : 'Off' }}</span>
            </div>
            <p :id="`${uid}-debug-help`" class="text-xs text-muted-foreground">
              Emits full error traces and the prompt-debug event stream. The
              stream switches when you save; verbose pod logs
              (<code class="font-mono">LOG_LEVEL=debug</code>) start on the
              next restart. Leave off in normal operation.
            </p>
          </AgentOverviewRow>

          <AgentOverviewRow label="Ranch admin tools">
            <div class="flex min-h-[34px] flex-wrap items-center gap-2">
              <Badge v-if="agent.isAdmin" variant="default" class="gap-1">
                <IconShield class="size-3" aria-hidden="true" /> Admin
              </Badge>
              <Badge v-else variant="outline">Not admin</Badge>
              <Button
                type="button"
                variant="outline"
                size="sm"
                :disabled="promoting"
                :data-admin-action="agent.isAdmin ? 'demote' : 'promote'"
                @click="onAdminAction"
              >
                <IconLoader2
                  v-if="promoting"
                  class="size-4 animate-spin motion-reduce:animate-none"
                />
                <IconShieldOff v-else-if="agent.isAdmin" class="size-4" />
                <IconShield v-else class="size-4" />
                {{ agent.isAdmin ? 'Demote' : 'Promote to admin' }}
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              <template v-if="agent.isAdmin">
                This agent has the <span class="font-mono">ranch_*</span> admin
                tools enabled and was deployed with
                <span class="font-mono">RANCH_ADMIN=true</span>. Demoting it
                drops those tools and redeploys.
              </template>
              <template v-else>
                Promote this agent to grant <span class="font-mono">ranch_*</span>
                admin tools and redeploy with
                <span class="font-mono">RANCH_ADMIN=true</span>. The flag is
                cleared from any other admin agent.
              </template>
              Acts at once after you confirm; it is not part of the save bar.
            </p>
            <p v-if="promoteError" class="text-xs text-destructive" role="alert">
              {{ promoteError }}
            </p>
          </AgentOverviewRow>

          <AgentOverviewRow label="Identifiers">
            <dl class="grid gap-1.5 text-xs @[460px]:pt-[7px]">
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted-foreground">Agent id</dt>
                <dd
                  class="min-w-0 select-all font-mono break-all text-foreground"
                  data-agent-id-text
                >{{ agent.id }}</dd>
              </div>
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted-foreground">Workflow</dt>
                <dd class="min-w-0 select-all font-mono break-all" data-workflow-id>
                  {{ agent.workflowId ?? '—' }}
                </dd>
              </div>
              <div class="flex flex-wrap gap-x-2" data-node-disk>
                <dt class="text-muted-foreground">Node disk</dt>
                <dd v-if="nodeDisk" class="min-w-0 break-words">
                  <span class="font-mono">{{ nodeDisk.name }}</span> · {{ nodeDisk.text }}
                </dd>
                <dd v-else class="min-w-0 text-muted-foreground">
                  {{ metricsAnswered
                    ? 'not available — no pod to measure, or metrics-server is not installed'
                    : 'loading…' }}
                </dd>
              </div>
              <div class="flex flex-wrap gap-x-2">
                <dt class="text-muted-foreground">Created</dt>
                <dd>
                  {{ formatDateTime(agent.createdAt) }}
                  <span class="text-muted-foreground">· updated</span>
                  {{ formatDateTime(agent.updatedAt) }}
                </dd>
              </div>
            </dl>
          </AgentOverviewRow>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </section>
</template>
