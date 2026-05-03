<script setup lang="ts">
import { Button } from '#theme/components/ui/button';
import { Badge } from '#theme/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '#theme/components/ui/card';
import { IconChevronDown, IconChevronRight, IconRefresh } from '@tabler/icons-vue';
import type {
  IPaddockEvaluationResult,
  IPaddockJudgeScore,
} from '#paddock/stores/paddockEvaluation';

const props = defineProps<{ evaluationId: string }>();

const store = usePaddockEvaluationStore();

const evaluation = ref(await store.fetchById(props.evaluationId));
const reportError = ref<string | null>(null);
const report = ref<{ md: string; json: object } | null>(null);
const polling = ref<ReturnType<typeof setInterval> | null>(null);
const expandedScenario = ref<string | null>(null);
const traces = ref<Record<string, object | null>>({});

async function refresh() {
  evaluation.value = await store.fetchById(props.evaluationId);
}

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

watch(
  () => evaluation.value?.status,
  (status) => {
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
  },
  { immediate: true },
);

onUnmounted(() => {
  if (polling.value) clearInterval(polling.value);
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
type ScenarioState = 'done' | 'current' | 'queued';

const scenarioState = (id: string): ScenarioState => {
  const ev = evaluation.value;
  if (!ev) return 'queued';
  if (ev.results.some((r) => r.scenarioId === id)) return 'done';
  if (ev.currentScenarioId === id) return 'current';
  return 'queued';
};

const completedCount = computed(
  () => evaluation.value?.results.length ?? 0,
);

const totalCount = computed(
  () => evaluation.value?.scenarioCount ?? 0,
);

const currentIndex = computed(() => {
  const ev = evaluation.value;
  if (!ev?.currentScenarioId) return null;
  const idx = ev.scenarios.findIndex(
    (s) => s.id === ev.currentScenarioId,
  );
  return idx >= 0 ? idx + 1 : null;
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

  <div v-else class="flex flex-col gap-6">
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
            :disabled="rerunning"
            @click="onRerun"
          >
            <IconRefresh class="size-4" :class="rerunning ? 'animate-spin' : ''" />
            {{ rerunning ? 'Starting…' : 'Rerun' }}
          </Button>
          <Button variant="ghost" @click="refresh()">Refresh</Button>
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
            class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            :class="{
              'border-primary/50 bg-primary/10': scenarioState(s.id) === 'current',
              'border-border bg-card': scenarioState(s.id) === 'done',
              'border-dashed bg-transparent text-muted-foreground': scenarioState(s.id) === 'queued',
            }"
          >
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
              class="text-xs italic text-primary"
            >
              running
            </span>
            <span
              v-else
              class="text-xs italic text-muted-foreground"
            >
              queued
            </span>
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
        <CardTitle>Per-scenario results</CardTitle>
        <CardDescription>Click a scenario to see judge reasoning, agent responses, tool calls, and errors.</CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-2">
        <div
          v-for="r in (evaluation.results as IPaddockEvaluationResult[])"
          :key="r.id"
          class="flex flex-col"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md border bg-card px-4 py-3 text-left hover:bg-muted transition-colors"
            :class="expandedScenario === r.scenarioId ? 'rounded-b-none' : ''"
            @click="toggleScenario(r.scenarioId)"
          >
            <IconChevronRight v-if="expandedScenario !== r.scenarioId" class="size-4 text-muted-foreground" />
            <IconChevronDown v-else class="size-4 text-muted-foreground" />

            <code class="text-xs flex-1 truncate">{{ r.scenarioId }}</code>

            <Badge :variant="verdictColor(r.verdict)">{{ r.verdict }}</Badge>
            <span class="text-sm tabular-nums w-16 text-right">{{ r.finalScore.toFixed(1) }}/10</span>
            <span class="text-xs text-muted-foreground tabular-nums w-12 text-right">
              {{ Math.round(r.agreement * 100) }}%
            </span>
          </button>

          <div
            v-show="expandedScenario === r.scenarioId"
            class="border border-t-0 rounded-b-md bg-muted/30 px-4 py-4"
          >
            <div class="flex flex-col gap-4">
              <!-- failure reasons -->
              <div v-if="r.failureReasons?.length" class="flex flex-col gap-1">
                <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Why it failed
                </h4>
                <ul class="flex flex-col gap-1 text-sm">
                  <li v-for="(reason, i) in r.failureReasons" :key="i" class="text-destructive">
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
                      class="flex items-start gap-2"
                    >
                      <span class="text-muted-foreground w-32 shrink-0">{{ dim }}</span>
                      <span class="tabular-nums w-8 shrink-0">{{ score }}/10</span>
                      <span class="text-muted-foreground">{{ j.reasoning[dim] }}</span>
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
                    class="rounded-md border bg-background px-3 py-2 text-xs whitespace-pre-wrap"
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
                    class="rounded-md border bg-background px-3 py-2 text-xs font-mono"
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
                    class="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-xs"
                  >
                    <span class="font-semibold">[{{ e.phase }}]</span> {{ e.message }}
                  </div>
                </div>
              </div>
              <p v-else-if="expandedScenario === r.scenarioId" class="text-xs text-muted-foreground">
                Loading trace…
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- markdown report -->
    <Card v-if="report?.md">
      <CardHeader>
        <CardTitle>Markdown report</CardTitle>
        <CardDescription>Full paddock-generated report (also persisted in S3).</CardDescription>
      </CardHeader>
      <CardContent>
        <pre class="whitespace-pre-wrap text-xs leading-relaxed font-mono">{{ report.md }}</pre>
      </CardContent>
    </Card>

    <div
      v-else-if="reportError"
      class="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground"
    >
      {{ reportError }}
    </div>
  </div>
</template>
