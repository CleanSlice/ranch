<script setup lang="ts">
import { marked } from 'marked';
import { toast } from 'vue-sonner';
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#theme/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#theme/components/ui/table';
import {
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
  IconLoader2,
  IconCopy,
  IconCheck,
} from '@tabler/icons-vue';
import type {
  IPaddockEvaluationResult,
  IPaddockJudgeScore,
} from '#paddock/stores/paddockEvaluation';
import type { IPaddockScenario } from '#paddock/stores/paddockScenario';

const props = defineProps<{ evaluationId: string }>();

const store = usePaddockEvaluationStore();

// Live-progress: which scenario rows the user has expanded, plus a cache
// of the fetched full data (messages, expectedBehavior, successCriteria).
// Reads from the evaluation's snapshot, NOT the global scenario store —
// the live `paddock_scenarios` table can drift (template re-seed assigns
// new UUIDs) so only the snapshot is reliable for past/running runs.
const expandedLiveScenario = ref<string | null>(null);
const liveScenarioCache = ref<Record<string, IPaddockScenario>>({});
const liveScenarioLoading = ref<Record<string, boolean>>({});
const liveScenarioError = ref<Record<string, boolean>>({});

async function loadLiveScenario(id: string) {
  liveScenarioLoading.value[id] = true;
  liveScenarioError.value[id] = false;
  try {
    const data = await store.fetchEvalScenario(props.evaluationId, id);
    if (data) {
      liveScenarioCache.value[id] = data as IPaddockScenario;
    } else {
      liveScenarioError.value[id] = true;
    }
  } catch {
    liveScenarioError.value[id] = true;
  } finally {
    liveScenarioLoading.value[id] = false;
  }
}

async function toggleLiveScenario(id: string) {
  if (expandedLiveScenario.value === id) {
    expandedLiveScenario.value = null;
    return;
  }
  expandedLiveScenario.value = id;
  if (!liveScenarioCache.value[id] && !liveScenarioLoading.value[id]) {
    await loadLiveScenario(id);
  }
}

const liveScenarioFor = (id: string): IPaddockScenario | null =>
  liveScenarioCache.value[id] ?? null;

const evaluation = ref(await store.fetchById(props.evaluationId));
const reportError = ref<string | null>(null);
const report = ref<{ md: string; json: object } | null>(null);
const polling = ref<ReturnType<typeof setInterval> | null>(null);
const expandedScenario = ref<string | null>(null);
const traces = ref<Record<string, object | null>>({});

const refreshing = ref(false);

async function refresh() {
  refreshing.value = true;
  try {
    evaluation.value = await store.fetchById(props.evaluationId);
  } finally {
    refreshing.value = false;
  }
}

const logLines = ref<string[]>([]);
const logsAutoScroll = ref(true);
const logsContainer = ref<HTMLElement | null>(null);
const logsPolling = ref<ReturnType<typeof setInterval> | null>(null);

async function refreshLogs() {
  try {
    logLines.value = await store.fetchLogs(props.evaluationId);
  } catch {
    // best-effort — logs are diagnostic, not critical
  }
}

function onLogsScroll(e: Event) {
  const el = e.target as HTMLElement;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 16;
  logsAutoScroll.value = atBottom;
}

function logLineClass(line: string): string {
  if (line.startsWith('[stderr]')) return 'text-destructive';
  if (line.includes('running scenario ')) return 'text-primary font-medium';
  if (/scenario \S+: OK/.test(line)) return 'text-green-600 dark:text-green-500';
  if (/scenario \S+: \d+ errors?/.test(line)) return 'text-destructive';
  if (line.startsWith('[paddock]')) return 'text-foreground/90';
  return 'text-foreground/70';
}

function logLineDisplay(line: string): string {
  return line.startsWith('[stderr] ') ? line.slice(9) : line;
}

watch(logLines, () => {
  if (!logsAutoScroll.value) return;
  nextTick(() => {
    const el = logsContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
});

async function loadReport() {
  reportError.value = null;
  try {
    report.value = await store.fetchReport(props.evaluationId);
  } catch (err: unknown) {
    reportError.value =
      err instanceof Error ? err.message : 'Report not available yet';
  }
}

async function loadTrace(scenarioId: string) {
  if (traces.value[scenarioId] !== undefined) return;
  try {
    traces.value[scenarioId] = await store.fetchTrace(
      props.evaluationId,
      scenarioId,
    );
  } catch {
    traces.value[scenarioId] = null;
  }
}

function toggleScenario(scenarioId: string) {
  if (expandedScenario.value === scenarioId) {
    expandedScenario.value = null;
  } else {
    expandedScenario.value = scenarioId;
    void loadTrace(scenarioId);
  }
}

async function onAbort() {
  await store.abort(props.evaluationId);
  await refresh();
}

const rerunning = ref(false);
const rerunError = ref<string | null>(null);

// How many scenarios would actually rerun (everything except passes).
// Mirrors the filter the API applies on the server side.
const rerunCount = computed(() => {
  const ev = evaluation.value;
  if (!ev) return 0;
  const passedIds = new Set(
    ev.results.filter((r) => r.verdict === 'pass').map((r) => r.scenarioId),
  );
  return ev.scenarios.filter((s) => !passedIds.has(s.id)).length;
});

async function onRerun() {
  rerunning.value = true;
  rerunError.value = null;
  try {
    const next = await store.rerun(props.evaluationId);
    await navigateTo(`/paddock/${next.id}`);
  } catch (err: unknown) {
    rerunError.value =
      err instanceof Error ? err.message : 'Failed to rerun evaluation';
  } finally {
    rerunning.value = false;
  }
}

function scrollToReport() {
  const el = document.getElementById('paddock-report-card');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function notifyCompletion(status: 'done' | 'failed') {
  const ev = evaluation.value;
  if (!ev) return;

  if (status === 'failed') {
    toast.error('Evaluation failed', {
      description: 'Paddock could not finish the run. See the report for details.',
      action: { label: 'View report', onClick: scrollToReport },
      duration: 10000,
    });
    return;
  }

  const passed = ev.passCount;
  const total = ev.scenarioCount;
  const rate = formatPassRate(ev.passRate);
  toast.success('Evaluation finished', {
    description: `${passed}/${total} scenarios passed (${rate}).`,
    action: { label: 'View report', onClick: scrollToReport },
    duration: 10000,
  });
}

watch(
  () => evaluation.value?.status,
  (status, prevStatus) => {
    if (status === 'running' && !polling.value) {
      polling.value = setInterval(refresh, 2000);
    }
    if (status !== 'running' && polling.value) {
      clearInterval(polling.value);
      polling.value = null;
    }
    if (
      (status === 'done' || status === 'failed') &&
      !report.value &&
      !reportError.value
    ) {
      void loadReport();
    }

    // Notify only on the live running → done/failed transition. Skip the
    // initial mount for already-finished evaluations (prevStatus is undefined).
    if (
      prevStatus === 'running' &&
      (status === 'done' || status === 'failed')
    ) {
      notifyCompletion(status);
    }

    // Logs: tail every 1.5s while running. After done/failed we still pull once
    // to capture the final lines (the in-memory ring buffer survives until the
    // next run for this agent or an API restart).
    if (status === 'running') {
      void refreshLogs();
      if (!logsPolling.value) {
        logsPolling.value = setInterval(refreshLogs, 1500);
      }
    } else {
      if (logsPolling.value) {
        clearInterval(logsPolling.value);
        logsPolling.value = null;
      }
      void refreshLogs();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (polling.value) clearInterval(polling.value);
  if (logsPolling.value) clearInterval(logsPolling.value);
});

const formatPassRate = (rate: number | null) =>
  rate === null ? '—' : `${Math.round(rate * 100)}%`;

const verdictColor = (verdict: string) => {
  if (verdict === 'pass') return 'default';
  if (verdict === 'partial') return 'secondary';
  if (verdict === 'skipped') return 'outline';
  return 'destructive';
};

interface TraceShape {
  responses?: Array<{ text: string; ts: number }>;
  toolCalls?: Array<{
    name: string;
    params: unknown;
    result: unknown;
    durationMs: number;
    ts: number;
    error?: string;
  }>;
  errors?: Array<{ message: string; phase: string; stack?: string }>;
  timing?: { totalMs: number };
}

const traceFor = (id: string): TraceShape | null =>
  (traces.value[id] as TraceShape | null) ?? null;

const judgeScoreEntries = (scores: Record<string, number>) =>
  Object.entries(scores).filter(([, v]) => v !== undefined);

const truncate = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n)}…`;

// Progress derivation while running.
// `done` — final result available (verdict + score)
// `processed` — paddock executed it but verdicts are batched at the end;
//   we infer it from currentScenarioId position (sequential exec order)
// `current` — actively running right now
// `queued` — not yet started
type ScenarioState = 'done' | 'processed' | 'current' | 'queued';

const currentScenarioIndex = computed(() => {
  const ev = evaluation.value;
  if (!ev?.currentScenarioId) return -1;
  return ev.scenarios.findIndex((s) => s.id === ev.currentScenarioId);
});

const scenarioState = (id: string): ScenarioState => {
  const ev = evaluation.value;
  if (!ev) return 'queued';
  if (ev.results.some((r) => r.scenarioId === id)) return 'done';
  if (ev.currentScenarioId === id) return 'current';
  const curIdx = currentScenarioIndex.value;
  if (curIdx >= 0) {
    const myIdx = ev.scenarios.findIndex((s) => s.id === id);
    if (myIdx >= 0 && myIdx < curIdx) return 'processed';
  }
  return 'queued';
};

const totalCount = computed(
  () => evaluation.value?.scenarioCount ?? 0,
);

const currentIndex = computed(() => {
  const idx = currentScenarioIndex.value;
  return idx >= 0 ? idx + 1 : null;
});

// "Done" for progress purposes = scenarios with full results OR scenarios
// already processed by paddock (sitting before currentScenarioId in execution
// order). The latter only matters mid-run — at end, results.length === total.
const completedCount = computed(() => {
  const ev = evaluation.value;
  if (!ev) return 0;
  if (ev.results.length > 0) return ev.results.length;
  return Math.max(0, currentScenarioIndex.value);
});

const progressPercent = computed(() => {
  const total = totalCount.value;
  if (total === 0) return 0;
  // While running, count the current as "in flight" (half done)
  const completed = completedCount.value;
  const inFlight = currentIndex.value !== null ? 0.5 : 0;
  return Math.min(100, Math.round(((completed + inFlight) / total) * 100));
});

const verdictForScenario = (
  id: string,
): { verdict: string; score: number } | null => {
  const r = evaluation.value?.results.find((x) => x.scenarioId === id);
  return r ? { verdict: r.verdict, score: r.finalScore } : null;
};

const scenarioInfoFor = (id: string) =>
  evaluation.value?.scenarios.find((s) => s.id === id) ?? null;

const sortByCategory = ref(false);

const sortedResults = computed<IPaddockEvaluationResult[]>(() => {
  const list = (evaluation.value?.results ?? []) as IPaddockEvaluationResult[];
  if (!sortByCategory.value) return list;
  return [...list].sort((a, b) => {
    const ca = scenarioInfoFor(a.scenarioId)?.category ?? '';
    const cb = scenarioInfoFor(b.scenarioId)?.category ?? '';
    if (ca !== cb) return ca.localeCompare(cb);
    return b.finalScore - a.finalScore;
  });
});

// Markdown render toggle for the eval report.
const markdownRendered = ref(false);

const reportCopied = ref(false);
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

async function copyReport() {
  const md = report.value?.md;
  if (!md) return;
  try {
    await navigator.clipboard.writeText(md);
    reportCopied.value = true;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => (reportCopied.value = false), 1500);
  } catch {
    reportCopied.value = false;
  }
}

onUnmounted(() => {
  if (copyResetTimer) clearTimeout(copyResetTimer);
});
const renderedReportHtml = computed(() => {
  if (!report.value?.md || !markdownRendered.value) return '';
  return marked.parse(report.value.md, { async: false }) as string;
});

// Tick every second to refresh elapsed-time display while running
const now = ref(Date.now());
let tickInterval: ReturnType<typeof setInterval> | null = null;

watch(
  () => evaluation.value?.status,
  (status) => {
    if (status === 'running' && !tickInterval) {
      tickInterval = setInterval(() => (now.value = Date.now()), 1000);
    }
    if (status !== 'running' && tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (tickInterval) clearInterval(tickInterval);
});

const elapsedLabel = computed(() => {
  const ev = evaluation.value;
  if (!ev) return '';
  const start = new Date(ev.startedAt).getTime();
  const end = ev.finishedAt ? new Date(ev.finishedAt).getTime() : now.value;
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`;
});
</script>

<template>
  <div v-if="!evaluation" class="text-sm text-muted-foreground">Evaluation not found.</div>

  <div v-else class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
    <div class="flex min-w-0 flex-col gap-6">
    <!-- header -->
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          Agent
          <code class="rounded bg-muted px-1.5 py-0.5">{{ evaluation.agentId }}</code>
        </div>
        <h1 class="text-2xl font-semibold">Evaluation</h1>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <code>{{ evaluation.id }}</code>
          <Badge :variant="evaluation.status === 'done' ? 'default' : evaluation.status === 'running' ? 'secondary' : 'destructive'">
            {{ evaluation.status }}
          </Badge>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <div class="flex gap-2">
          <Button v-if="evaluation.status === 'running'" variant="outline" @click="onAbort">Abort</Button>
          <Button
            v-else
            variant="outline"
            :disabled="rerunning || rerunCount === 0"
            :title="rerunCount === 0
              ? 'All scenarios passed — nothing to rerun'
              : `Reruns ${rerunCount} non-passing scenario(s); skips ${evaluation.passCount} passed`"
            @click="onRerun"
          >
            <IconRefresh class="size-4" :class="rerunning ? 'animate-spin' : ''" />
            {{ rerunning ? 'Starting…' : `Rerun failed${rerunCount > 0 ? ` (${rerunCount})` : ''}` }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="refreshing"
            @click="refresh()"
          >
            <IconLoader2 v-if="refreshing" class="size-4 animate-spin" />
            <IconRefresh v-else class="size-4" />
          </Button>
        </div>
        <p v-if="rerunError" class="text-xs text-destructive">{{ rerunError }}</p>
      </div>
    </div>

    <!-- live progress (only while running) -->
    <Card v-if="evaluation.status === 'running'" class="border-primary/40 bg-primary/5">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between gap-4">
          <div>
            <CardTitle class="flex items-center gap-2 text-base">
              <span class="relative flex size-2.5">
                <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                <span class="relative inline-flex size-2.5 rounded-full bg-primary"></span>
              </span>
              Evaluating
              <span v-if="currentIndex !== null" class="text-sm font-normal text-muted-foreground">
                — scenario {{ currentIndex }} of {{ totalCount }}
              </span>
              <span v-else class="text-sm font-normal text-muted-foreground">
                — preparing…
              </span>
            </CardTitle>
            <CardDescription>
              {{ completedCount }} of {{ totalCount }} done · {{ progressPercent }}% · running for {{ elapsedLabel }}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent class="flex flex-col gap-3">
        <!-- progress bar -->
        <div class="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            class="h-full bg-primary transition-all duration-500"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>

        <!-- scenarios list -->
        <ul class="flex flex-col gap-1.5">
          <li
            v-for="s in evaluation.scenarios"
            :key="s.id"
            class="rounded-md border text-sm"
            :class="{
              'border-primary/50 bg-primary/10': scenarioState(s.id) === 'current',
              'border-border bg-card': scenarioState(s.id) === 'done',
              'border-border bg-muted/40': scenarioState(s.id) === 'processed',
              'border-dashed bg-transparent text-muted-foreground': scenarioState(s.id) === 'queued',
            }"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 px-3 py-2 text-left"
              @click="toggleLiveScenario(s.id)"
            >
              <!-- chevron -->
              <IconChevronDown
                v-if="expandedLiveScenario === s.id"
                class="size-3.5 shrink-0 text-muted-foreground"
              />
              <IconChevronRight
                v-else
                class="size-3.5 shrink-0 text-muted-foreground"
              />

              <!-- state icon -->
              <span class="flex size-5 shrink-0 items-center justify-center">
                <template v-if="scenarioState(s.id) === 'current'">
                  <span class="size-3 rounded-full bg-primary animate-pulse" />
                </template>
                <template v-else-if="scenarioState(s.id) === 'done'">
                  <span
                    class="flex size-5 items-center justify-center rounded-full text-[10px] text-white"
                    :class="verdictForScenario(s.id)?.verdict === 'pass' ? 'bg-green-600' :
                            verdictForScenario(s.id)?.verdict === 'partial' ? 'bg-yellow-500' :
                            verdictForScenario(s.id)?.verdict === 'skipped' ? 'bg-muted-foreground' :
                            'bg-destructive'"
                  >
                    ✓
                  </span>
                </template>
                <template v-else-if="scenarioState(s.id) === 'processed'">
                  <span class="flex size-5 items-center justify-center rounded-full bg-muted-foreground/40 text-[10px] text-white">
                    ✓
                  </span>
                </template>
                <template v-else>
                  <span class="size-2 rounded-full bg-muted-foreground/30" />
                </template>
              </span>

              <span class="font-medium flex-1 truncate">{{ s.name }}</span>

              <Badge variant="outline" class="text-xs">{{ s.category }}</Badge>
              <Badge variant="outline" class="text-xs">{{ s.difficulty }}</Badge>

              <span
                v-if="verdictForScenario(s.id)"
                class="tabular-nums text-xs w-12 text-right"
              >
                {{ verdictForScenario(s.id)!.score.toFixed(1) }}
              </span>
              <span
                v-else-if="scenarioState(s.id) === 'current'"
                class="text-xs italic text-primary w-12 text-right"
              >
                running
              </span>
              <span
                v-else-if="scenarioState(s.id) === 'processed'"
                class="text-xs italic text-muted-foreground w-12 text-right"
              >
                done
              </span>
              <span
                v-else
                class="text-xs italic text-muted-foreground w-12 text-right"
              >
                queued
              </span>
            </button>

            <!-- expanded scenario detail -->
            <div
              v-if="expandedLiveScenario === s.id"
              class="border-t bg-background/50 px-3 py-3 flex flex-col gap-3 text-xs"
            >
              <p
                v-if="s.description"
                class="text-muted-foreground"
              >
                {{ s.description }}
              </p>

              <template v-if="liveScenarioFor(s.id)">
                <div v-if="liveScenarioFor(s.id)!.expectedBehavior" class="flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Expected behavior
                  </span>
                  <p class="whitespace-pre-wrap leading-relaxed">
                    {{ liveScenarioFor(s.id)!.expectedBehavior }}
                  </p>
                </div>

                <div v-if="liveScenarioFor(s.id)!.messages?.length" class="flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    User messages ({{ liveScenarioFor(s.id)!.messages.length }})
                  </span>
                  <div class="flex flex-col gap-1.5">
                    <div
                      v-for="(m, i) in liveScenarioFor(s.id)!.messages"
                      :key="i"
                      class="rounded-md border bg-muted/40 px-2.5 py-1.5"
                    >
                      <div class="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <code>{{ m.from }}</code>
                        <span v-if="m.delayMs">+{{ m.delayMs }}ms</span>
                      </div>
                      <p class="mt-0.5 whitespace-pre-wrap">{{ m.text }}</p>
                    </div>
                  </div>
                </div>

                <div v-if="liveScenarioFor(s.id)!.successCriteria?.length" class="flex flex-col gap-1">
                  <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Success criteria
                  </span>
                  <ul class="flex flex-col gap-1">
                    <li
                      v-for="(c, i) in liveScenarioFor(s.id)!.successCriteria"
                      :key="i"
                      class="flex items-start gap-2"
                    >
                      <Badge variant="secondary" class="text-[9px] shrink-0">
                        {{ c.dimension }} · {{ Math.round(c.weight * 100) }}%
                      </Badge>
                      <span class="text-muted-foreground">{{ c.description }}</span>
                    </li>
                  </ul>
                </div>
              </template>

              <p
                v-else-if="liveScenarioLoading[s.id]"
                class="flex items-center gap-2 text-muted-foreground italic"
              >
                <IconLoader2 class="size-3.5 animate-spin" />
                Loading…
              </p>
              <div
                v-else-if="liveScenarioError[s.id]"
                class="flex items-center justify-between gap-2 text-muted-foreground italic"
              >
                <span>Could not load scenario details.</span>
                <button
                  type="button"
                  class="cursor-pointer rounded-md border border-border px-2 py-0.5 text-[10px] not-italic hover:bg-muted"
                  @click.stop="loadLiveScenario(s.id)"
                >
                  Retry
                </button>
              </div>
            </div>
          </li>
        </ul>
      </CardContent>
    </Card>

    <!-- summary tiles -->
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Pass rate</CardDescription>
          <CardTitle :class="evaluation.passRate !== null && evaluation.passRate >= 0.8 ? 'text-green-600' : evaluation.passRate !== null && evaluation.passRate < 0.5 ? 'text-destructive' : ''">
            {{ formatPassRate(evaluation.passRate) }}
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Pass</CardDescription>
          <CardTitle class="text-green-600">{{ evaluation.passCount }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Fail</CardDescription>
          <CardTitle :class="evaluation.failCount > 0 ? 'text-destructive' : ''">{{ evaluation.failCount }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Partial</CardDescription>
          <CardTitle>{{ evaluation.partialCount }}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>Skipped</CardDescription>
          <CardTitle>{{ evaluation.skippedCount }}</CardTitle>
        </CardHeader>
      </Card>
    </div>

    <div
      v-if="evaluation.errorMessage"
      class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <strong>Error:</strong> {{ evaluation.errorMessage }}
    </div>

    <!-- per-scenario expandable -->
    <Card v-if="evaluation.results.length">
      <CardHeader>
        <div class="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Per-scenario results</CardTitle>
            <CardDescription>Click a scenario to see judge reasoning, agent responses, tool calls, and errors.</CardDescription>
          </div>
          <div class="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Sort</span>
            <button
              type="button"
              class="cursor-pointer rounded-md px-2 py-0.5 font-medium transition-colors"
              :class="!sortByCategory
                ? 'border border-foreground/30 bg-muted text-foreground'
                : 'border border-transparent bg-muted/50 hover:bg-muted'"
              @click="sortByCategory = false"
            >
              Default
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-md px-2 py-0.5 font-medium transition-colors"
              :class="sortByCategory
                ? 'border border-foreground/30 bg-muted text-foreground'
                : 'border border-transparent bg-muted/50 hover:bg-muted'"
              @click="sortByCategory = true"
            >
              Category
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent class="p-0">
        <div class="rounded-md border-t bg-card">
          <Table class="w-full table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead class="w-32">Category</TableHead>
                <TableHead class="w-28">Difficulty</TableHead>
                <TableHead class="w-24">Verdict</TableHead>
                <TableHead class="w-20 text-right">Score</TableHead>
                <TableHead class="w-24 text-right">Agreement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <template v-for="r in sortedResults" :key="r.id">
                <TableRow
                  class="cursor-pointer"
                  :class="expandedScenario === r.scenarioId ? 'bg-muted/40' : ''"
                  @click="toggleScenario(r.scenarioId)"
                >
                  <TableCell>
                    <div class="flex items-start gap-2">
                      <IconChevronRight v-if="expandedScenario !== r.scenarioId" class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <IconChevronDown v-else class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div class="flex min-w-0 flex-col gap-0.5">
                        <span class="truncate font-medium">
                          {{ scenarioInfoFor(r.scenarioId)?.name ?? r.scenarioId }}
                        </span>
                        <span
                          v-if="scenarioInfoFor(r.scenarioId)?.description"
                          class="line-clamp-2 text-xs text-muted-foreground"
                        >
                          {{ scenarioInfoFor(r.scenarioId)?.description }}
                        </span>
                        <code class="truncate text-[10px] text-muted-foreground/70">{{ r.scenarioId }}</code>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge v-if="scenarioInfoFor(r.scenarioId)?.category" variant="outline">
                      {{ scenarioInfoFor(r.scenarioId)?.category }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge v-if="scenarioInfoFor(r.scenarioId)?.difficulty" variant="secondary">
                      {{ scenarioInfoFor(r.scenarioId)?.difficulty }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge :variant="verdictColor(r.verdict)">{{ r.verdict }}</Badge>
                  </TableCell>
                  <TableCell class="text-right tabular-nums">{{ r.finalScore.toFixed(1) }}/10</TableCell>
                  <TableCell class="text-right tabular-nums text-muted-foreground">
                    {{ Math.round(r.agreement * 100) }}%
                  </TableCell>
                </TableRow>

                <TableRow v-if="expandedScenario === r.scenarioId" class="bg-muted/30 hover:bg-muted/30">
                  <TableCell :colspan="6" class="p-4">
                    <div class="flex w-full min-w-0 flex-col gap-4">
                      <!-- failure reasons -->
                      <div v-if="r.failureReasons?.length" class="flex flex-col gap-1">
                        <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Why it failed
                        </h4>
                        <ul class="flex flex-col gap-1 text-sm">
                          <li v-for="(reason, i) in r.failureReasons" :key="i" class="wrap-break-word whitespace-break-spaces text-destructive">
                            {{ reason }}
                          </li>
                        </ul>
                      </div>

                      <!-- judge reasoning -->
                      <div v-if="r.judges?.length" class="flex flex-col gap-3">
                        <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Judges ({{ r.judges.length }})
                        </h4>
                        <div
                          v-for="(j, i) in (r.judges as IPaddockJudgeScore[])"
                          :key="i"
                          class="rounded-md border bg-background p-3 flex flex-col gap-2"
                        >
                          <div class="flex items-center justify-between">
                            <span class="text-sm font-medium">{{ j.judgeModel }}</span>
                            <div class="flex items-center gap-2">
                              <Badge :variant="verdictColor(j.verdict)">{{ j.verdict }}</Badge>
                              <span class="text-xs tabular-nums">{{ j.overallScore.toFixed(1) }}/10</span>
                              <span class="text-xs text-muted-foreground">conf {{ Math.round(j.confidence * 100) }}%</span>
                            </div>
                          </div>

                          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <div
                              v-for="[dim, score] in judgeScoreEntries(j.scores)"
                              :key="dim"
                              class="flex min-w-0 items-start gap-2"
                            >
                              <span class="text-muted-foreground w-32 shrink-0">{{ dim }}</span>
                              <span class="tabular-nums w-8 shrink-0">{{ score }}/10</span>
                              <span class="wrap-break-word whitespace-break-spaces text-muted-foreground">{{ j.reasoning[dim] }}</span>
                            </div>
                          </div>

                          <div v-if="j.suggestions?.length" class="flex flex-col gap-1 mt-1">
                            <span class="text-xs font-semibold text-muted-foreground">Suggestions</span>
                            <ul class="text-xs flex flex-col gap-0.5">
                              <li v-for="(s, si) in j.suggestions" :key="si">— {{ s }}</li>
                            </ul>
                          </div>
                        </div>
                      </div>

                      <!-- trace -->
                      <div v-if="traceFor(r.scenarioId)" class="flex flex-col gap-3">
                        <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Execution trace
                        </h4>

                        <div v-if="traceFor(r.scenarioId)?.responses?.length" class="flex flex-col gap-1">
                          <span class="text-xs font-semibold">Agent responses ({{ traceFor(r.scenarioId)?.responses?.length }})</span>
                          <div
                            v-for="(resp, ri) in traceFor(r.scenarioId)?.responses"
                            :key="ri"
                            class="wrap-break-word rounded-md border bg-background px-3 py-2 text-xs whitespace-pre-wrap"
                          >
                            {{ resp.text }}
                          </div>
                        </div>
                        <p v-else class="text-xs text-muted-foreground">No agent responses captured.</p>

                        <div v-if="traceFor(r.scenarioId)?.toolCalls?.length" class="flex flex-col gap-1">
                          <span class="text-xs font-semibold">Tool calls ({{ traceFor(r.scenarioId)?.toolCalls?.length }})</span>
                          <div
                            v-for="(tc, ti) in traceFor(r.scenarioId)?.toolCalls"
                            :key="ti"
                            class="overflow-x-auto rounded-md border bg-background px-3 py-2 text-xs font-mono whitespace-nowrap"
                          >
                            <span :class="tc.error ? 'text-destructive' : 'text-foreground'">{{ tc.name }}</span>
                            <span class="text-muted-foreground">({{ truncate(JSON.stringify(tc.params), 80) }})</span>
                            <span class="text-muted-foreground"> → {{ tc.error ? `ERROR: ${tc.error}` : truncate(JSON.stringify(tc.result), 80) }}</span>
                            <span class="text-muted-foreground"> [{{ tc.durationMs }}ms]</span>
                          </div>
                        </div>

                        <div v-if="traceFor(r.scenarioId)?.errors?.length" class="flex flex-col gap-1">
                          <span class="text-xs font-semibold text-destructive">Errors ({{ traceFor(r.scenarioId)?.errors?.length }})</span>
                          <div
                            v-for="(e, ei) in traceFor(r.scenarioId)?.errors"
                            :key="ei"
                            class="wrap-break-word whitespace-break-spaces rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs"
                          >
                            <span class="font-semibold">[{{ e.phase }}]</span> {{ e.message }}
                          </div>
                        </div>
                      </div>
                      <p v-else class="text-xs text-muted-foreground">
                        Loading trace…
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              </template>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <!-- markdown report -->
    <Card v-if="report?.md" id="paddock-report-card">
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Report</CardTitle>
            <CardDescription>Full paddock-generated report (also persisted in S3).</CardDescription>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="flex cursor-pointer items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70"
              :class="reportCopied ? 'border border-foreground/30 text-foreground' : 'border border-transparent'"
              @click="copyReport"
            >
              <IconCheck v-if="reportCopied" class="size-3" />
              <IconCopy v-else class="size-3" />
              {{ reportCopied ? 'Copied' : 'Copy' }}
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/70"
              :class="markdownRendered
                ? 'border border-foreground/30 text-foreground'
                : 'border border-transparent'"
              @click="markdownRendered = !markdownRendered"
            >
              Markdown
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div class="paddock-report pr-6 wrap-break-word">
          <pre
            v-if="!markdownRendered"
            class="whitespace-pre-wrap text-xs leading-relaxed font-mono"
          >{{ report.md }}</pre>
          <div v-else class="text-sm leading-relaxed" v-html="renderedReportHtml" />
        </div>
      </CardContent>
    </Card>

    <div
      v-else-if="reportError"
      class="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground"
    >
      {{ reportError }}
    </div>
    </div>

    <!-- right rail: live paddock CLI logs -->
    <aside class="flex min-w-0 flex-col lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
      <Card class="flex flex-1 min-h-0 flex-col overflow-hidden">
        <CardHeader class="flex-row items-center justify-between gap-3 space-y-0 border-b py-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="relative flex size-2 shrink-0">
              <span
                v-if="evaluation.status === 'running'"
                class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"
              ></span>
              <span
                class="relative inline-flex size-2 rounded-full"
                :class="evaluation.status === 'running' ? 'bg-primary' : 'bg-muted-foreground/40'"
              ></span>
            </span>
            <CardTitle class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Paddock logs
            </CardTitle>
          </div>
          <div class="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
            <span>{{ logLines.length }} {{ logLines.length === 1 ? 'line' : 'lines' }}</span>
            <span v-if="evaluation.status === 'running'" class="text-primary font-medium">live</span>
            <button
              v-else-if="logLines.length > 0"
              type="button"
              class="cursor-pointer rounded-md border border-transparent px-1.5 py-0.5 hover:bg-muted"
              @click="refreshLogs"
            >
              refresh
            </button>
          </div>
        </CardHeader>
        <div
          ref="logsContainer"
          class="paddock-logs flex-1 min-h-[20rem] overflow-y-auto bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all"
          @scroll="onLogsScroll"
        >
          <template v-if="logLines.length">
            <div
              v-for="(line, i) in logLines"
              :key="i"
              :class="logLineClass(line)"
            >{{ logLineDisplay(line) }}</div>
          </template>
          <div v-else class="flex h-full flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span class="text-2xl text-muted-foreground/40">⎯</span>
            <p class="text-xs text-muted-foreground">
              {{ evaluation.status === 'running' ? 'Waiting for paddock output…' : 'No logs captured for this run.' }}
            </p>
            <p
              v-if="evaluation.status === 'running'"
              class="text-[10px] text-muted-foreground/70"
            >
              First lines appear once paddock CLI prints stdout.
            </p>
          </div>
        </div>
        <div
          v-if="!logsAutoScroll && logLines.length"
          class="border-t bg-card/60 px-3 py-1.5 text-[10px] text-muted-foreground"
        >
          Auto-scroll paused — scroll to bottom to resume.
        </div>
      </Card>
    </aside>
  </div>
</template>

<style scoped>
/* Slim, terminal-feel scrollbar for the live paddock logs panel. */
.paddock-logs {
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
}
.paddock-logs::-webkit-scrollbar {
  width: 6px;
}
.paddock-logs::-webkit-scrollbar-track {
  background: transparent;
}
.paddock-logs::-webkit-scrollbar-thumb {
  background: hsl(var(--muted-foreground) / 0.3);
  border-radius: 3px;
}
.paddock-logs::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground) / 0.5);
}

/* Rendered markdown report — keep tables scrollable inside their cell so
   long rows don't blow out the layout, and give content breathing room. */
.paddock-report :deep(table) {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.8125rem;
}
.paddock-report :deep(thead) {
  background: hsl(var(--muted) / 0.4);
}
.paddock-report :deep(th),
.paddock-report :deep(td) {
  border: 1px solid hsl(var(--border));
  padding: 0.375rem 0.625rem;
  text-align: left;
  white-space: nowrap;
}
.paddock-report :deep(h1),
.paddock-report :deep(h2),
.paddock-report :deep(h3),
.paddock-report :deep(h4) {
  font-weight: 600;
  margin: 1.25rem 0 0.5rem;
  line-height: 1.3;
}
.paddock-report :deep(h1) { font-size: 1.25rem; }
.paddock-report :deep(h2) { font-size: 1.1rem; }
.paddock-report :deep(h3) { font-size: 1rem; }
.paddock-report :deep(p) {
  margin: 0.5rem 0;
}
.paddock-report :deep(ul),
.paddock-report :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.5rem;
}
.paddock-report :deep(li) {
  margin: 0.125rem 0;
}
.paddock-report :deep(code) {
  background: hsl(var(--muted) / 0.6);
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  font-size: 0.85em;
}
.paddock-report :deep(pre) {
  background: hsl(var(--muted) / 0.4);
  padding: 0.75rem;
  border-radius: 0.375rem;
  overflow-x: auto;
  font-size: 0.8125rem;
}
.paddock-report :deep(strong) {
  font-weight: 600;
}
</style>
