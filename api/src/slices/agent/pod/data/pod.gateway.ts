import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  CoreV1Api,
  KubeConfig,
  Metrics,
  V1Node,
  V1Pod,
  Watch,
} from '@kubernetes/client-node';
import { Observable, Subject } from 'rxjs';
import { IPodGateway } from '../domain/pod.gateway';
import { formatKubeError } from '../domain/kubeError';
import { IInfraConfigGateway } from '#/setting/domain';
import {
  AGENT_SLOT_CPU_MILLI,
  AGENT_SLOT_MEM_BYTES,
  IAgentMetrics,
  IAgentPodEvent,
  IAgentPodStatus,
  IClusterCapacity,
  INodeCapacity,
  PodEventTypes,
  PodPhaseTypes,
} from '../domain/pod.types';

const AGENT_POD_LABEL_KEY = 'app';
const AGENT_POD_LABEL_VALUE = 'ranch-agent';
const POD_LABEL_SELECTOR = `${AGENT_POD_LABEL_KEY}=${AGENT_POD_LABEL_VALUE}`;
const AGENT_ID_LABEL = 'ranch/agent-id';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// Agent pods only schedule on the dedicated agent node pool — capacity on any
// other node is irrelevant. Mirrors nodeSelector/tolerations in
// agent-workflow.manifest.ts.
const AGENT_NODE_LABEL_KEY = 'node-role';
const AGENT_NODE_LABEL_VALUE = 'agents';
const TOLERATED_TAINT = { key: 'workload', value: 'agent', effect: 'NoSchedule' };

const CAPACITY_CACHE_TTL_MS = 15_000;

@Injectable()
export class KubePodGateway
  extends IPodGateway
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KubePodGateway.name);
  private kc!: KubeConfig;
  private coreApi!: CoreV1Api;
  private metricsClient!: Metrics;
  private namespace!: string;

  private readonly statuses = new Map<string, IAgentPodStatus>();
  private readonly events = new Subject<IAgentPodEvent>();

  private watchRequest: { abort: () => void } | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private destroyed = false;

  private capacityCache: { value: IClusterCapacity; at: number } | null = null;
  private capacityInflight: Promise<IClusterCapacity | null> | null = null;

  constructor(private infraConfig: IInfraConfigGateway) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const [namespace, skipTls] = await Promise.all([
      this.infraConfig.getAgentsNamespace(),
      this.infraConfig.getKubeSkipTlsVerify(),
    ]);
    this.namespace = namespace;

    this.kc = new KubeConfig();
    this.kc.loadFromDefault();
    if (skipTls) {
      const current = this.kc.getCurrentCluster();
      if (current) {
        this.kc.clusters = this.kc.clusters.map((c) =>
          c.name === current.name ? { ...c, skipTLSVerify: true } : c,
        );
      }
    }
    this.coreApi = this.kc.makeApiClient(CoreV1Api);
    this.metricsClient = new Metrics(this.kc);

    await this.resync();
    this.startWatch();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.watchRequest?.abort();
    this.watchRequest = null;
    this.events.complete();
  }

  async delete(agentId: string): Promise<void> {
    const name = `agent-${agentId}`;
    try {
      await this.coreApi.deleteNamespacedPod({
        name,
        namespace: this.namespace,
        propagationPolicy: 'Background',
      });
    } catch (err) {
      if (this.isNotFound(err)) return;
      this.logger.warn(
        `Pod delete failed for ${name}: ${this.extractKubeError(err)}`,
      );
    }
  }

  async list(): Promise<IAgentPodStatus[]> {
    return Array.from(this.statuses.values());
  }

  events$(): Observable<IAgentPodEvent> {
    return this.events.asObservable();
  }

  async resync(): Promise<void> {
    let res;
    try {
      res = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: POD_LABEL_SELECTOR,
      });
    } catch (err) {
      this.logger.warn(
        `Pod resync failed: ${this.extractKubeError(err)} — cache stays as-is`,
      );
      return;
    }

    const fresh = new Map<string, IAgentPodStatus>();
    for (const pod of res.items ?? []) {
      const status = this.mapPodStatus(pod);
      if (status) fresh.set(status.agentId, status);
    }

    let added = 0;
    let modified = 0;
    let deleted = 0;

    // Pods that disappeared while we weren't looking. Subscribers can choose
    // to ignore (the agent status reconciler does — pod deletion is an
    // expected step of restart and shouldn't flip DB to failed).
    for (const [agentId, prev] of this.statuses) {
      if (!fresh.has(agentId)) {
        this.events.next({ type: 'deleted', status: prev });
        deleted += 1;
      }
    }

    // Replay state changes the watch may have missed (no resourceVersion →
    // events resume from "now" on reconnect, so any phase/ready transition
    // during the gap is otherwise invisible).
    for (const [agentId, status] of fresh) {
      const prev = this.statuses.get(agentId);
      if (!prev) {
        this.events.next({ type: 'added', status });
        added += 1;
      } else if (this.statusChanged(prev, status)) {
        this.events.next({ type: 'modified', status });
        modified += 1;
      }
    }

    this.statuses.clear();
    for (const [agentId, status] of fresh) {
      this.statuses.set(agentId, status);
    }

    if (added || modified || deleted) {
      this.capacityCache = null;
      this.logger.log(
        `Pod resync (${this.namespace}): ${fresh.size} pods — ${added} added, ${modified} modified, ${deleted} deleted`,
      );
    }
  }

  private statusChanged(prev: IAgentPodStatus, next: IAgentPodStatus): boolean {
    return (
      prev.phase !== next.phase ||
      prev.ready !== next.ready ||
      prev.containerWaitingReason !== next.containerWaitingReason ||
      prev.lastTerminationReason !== next.lastTerminationReason ||
      prev.restartCount !== next.restartCount ||
      prev.podName !== next.podName
    );
  }

  private startWatch(): void {
    if (this.destroyed) return;

    const watch = new Watch(this.kc);
    const path = `/api/v1/namespaces/${this.namespace}/pods`;

    watch
      .watch(
        path,
        { labelSelector: POD_LABEL_SELECTOR },
        (phase: string, apiObj: V1Pod) => this.handleWatchEvent(phase, apiObj),
        (err: unknown) => this.handleWatchClosed(err),
      )
      .then((req) => {
        this.watchRequest = req as { abort: () => void };
        this.reconnectDelayMs = RECONNECT_BASE_MS;
      })
      .catch((err) => this.handleWatchClosed(err));
  }

  private handleWatchEvent(phase: string, pod: V1Pod): void {
    const status = this.mapPodStatus(pod);
    if (!status) return;

    const eventType = this.mapEventType(phase);
    if (!eventType) return;

    if (eventType === 'deleted') {
      this.statuses.delete(status.agentId);
    } else {
      this.statuses.set(status.agentId, status);
    }

    // Any agent pod change shifts the capacity math — drop the cache so the
    // next getClusterCapacity() reflects it immediately (the TTL only guards
    // against non-agent workload churn we can't observe).
    this.capacityCache = null;

    this.events.next({ type: eventType, status });
  }

  private handleWatchClosed(err: unknown): void {
    if (this.destroyed) return;

    this.watchRequest = null;
    if (err) {
      this.logger.warn(
        `Pod watch closed: ${this.extractKubeError(err)} — reconnecting in ${this.reconnectDelayMs}ms`,
      );
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelayMs = Math.min(
        this.reconnectDelayMs * 2,
        RECONNECT_MAX_MS,
      );
      void this.resync().finally(() => this.startWatch());
    }, this.reconnectDelayMs);
  }

  private mapEventType(phase: string): PodEventTypes | null {
    switch (phase) {
      case 'ADDED':
        return 'added';
      case 'MODIFIED':
        return 'modified';
      case 'DELETED':
        return 'deleted';
      default:
        return null;
    }
  }

  private mapPodStatus(pod: V1Pod): IAgentPodStatus | null {
    const labels = pod.metadata?.labels ?? {};
    const agentId = labels[AGENT_ID_LABEL];
    const podName = pod.metadata?.name;
    if (!agentId || !podName) return null;

    const containerState = pod.status?.containerStatuses?.[0];

    return {
      agentId,
      podName,
      phase: this.mapPhase(pod.status?.phase),
      ready: containerState?.ready ?? false,
      restartCount: containerState?.restartCount ?? 0,
      startedAt: this.toIso(pod.status?.startTime),
      lastTerminationReason:
        containerState?.lastState?.terminated?.reason ?? null,
      containerWaitingReason: containerState?.state?.waiting?.reason ?? null,
      message: pod.status?.message ?? null,
      observedAt: new Date().toISOString(),
    };
  }

  private mapPhase(raw: string | undefined): PodPhaseTypes {
    switch (raw) {
      case 'Pending':
      case 'Running':
      case 'Succeeded':
      case 'Failed':
        return raw;
      default:
        return 'Unknown';
    }
  }

  private toIso(value: Date | string | undefined | null): string | null {
    if (!value) return null;
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { statusCode?: number; code?: number };
    return e.statusCode === 404 || e.code === 404;
  }

  private extractKubeError(err: unknown): string {
    return formatKubeError(err);
  }

  async getMetrics(agentId: string): Promise<IAgentMetrics | null> {
    const name = `agent-${agentId}`;

    let pod: V1Pod;
    try {
      pod = await this.coreApi.readNamespacedPod({
        name,
        namespace: this.namespace,
      });
    } catch (err) {
      if (this.isNotFound(err)) return null;
      this.logger.warn(
        `Pod read failed for ${name}: ${this.extractKubeError(err)}`,
      );
      return null;
    }

    const nodeName = pod.spec?.nodeName;
    if (!nodeName) return null;

    const limits = pod.spec?.containers?.[0]?.resources?.limits ?? {};
    const cpuLimitMilli = parseCpuToMilli(limits.cpu) ?? 0;
    const memLimitBytes = parseMemoryToBytes(limits.memory) ?? 0;

    // Pod CPU/memory usage (metrics-server). Sum across containers — for the
    // ranch-agent pod there's only one, but staying generic is harmless.
    let cpuMilli = 0;
    let memBytes = 0;
    try {
      const list = await this.metricsClient.getPodMetrics(this.namespace);
      const podMetric = list.items.find((p) => p.metadata.name === name);
      if (podMetric) {
        for (const c of podMetric.containers) {
          cpuMilli += parseCpuToMilli(c.usage.cpu) ?? 0;
          memBytes += parseMemoryToBytes(c.usage.memory) ?? 0;
        }
      }
    } catch (err) {
      this.logger.warn(
        `Pod metrics fetch failed for ${name}: ${this.extractKubeError(err)}`,
      );
    }

    // Node-level filesystem stats come from the kubelet summary endpoint —
    // metrics-server doesn't expose disk. proxyResponse is the raw JSON body.
    let diskAvailBytes = 0;
    let diskCapacityBytes = 0;
    try {
      const raw = await this.coreApi.connectGetNodeProxyWithPath({
        name: nodeName,
        path: 'stats/summary',
      });
      const summary = JSON.parse(raw) as {
        node?: { fs?: { availableBytes?: number; capacityBytes?: number } };
      };
      diskAvailBytes = summary.node?.fs?.availableBytes ?? 0;
      diskCapacityBytes = summary.node?.fs?.capacityBytes ?? 0;
    } catch (err) {
      this.logger.warn(
        `Node stats/summary failed for ${nodeName}: ${this.extractKubeError(err)}`,
      );
    }

    return {
      pod: { cpuMilli, memBytes, cpuLimitMilli, memLimitBytes },
      node: { name: nodeName, diskAvailBytes, diskCapacityBytes },
    };
  }

  // "How many more agents fit" — free schedulable CPU/memory on agent nodes
  // divided by the fixed agent requests floor. Cached briefly; the pod watch
  // drops the cache the moment an agent pod appears/disappears.
  async getClusterCapacity(): Promise<IClusterCapacity | null> {
    if (
      this.capacityCache &&
      Date.now() - this.capacityCache.at < CAPACITY_CACHE_TTL_MS
    ) {
      return this.capacityCache.value;
    }
    if (this.capacityInflight) return this.capacityInflight;

    this.capacityInflight = this.fetchClusterCapacity().finally(() => {
      this.capacityInflight = null;
    });
    return this.capacityInflight;
  }

  private async fetchClusterCapacity(): Promise<IClusterCapacity | null> {
    try {
      // Pods from ALL namespaces: daemonsets and platform workloads pinned to
      // agent nodes consume the same allocatable pool as agents do.
      const [nodeList, podList] = await Promise.all([
        this.coreApi.listNode(),
        this.coreApi.listPodForAllNamespaces({
          fieldSelector: 'status.phase!=Succeeded,status.phase!=Failed',
        }),
      ]);
      const value = computeClusterCapacity(
        nodeList.items ?? [],
        podList.items ?? [],
      );
      this.capacityCache = { value, at: Date.now() };
      return value;
    } catch (err) {
      this.logger.warn(
        `Cluster capacity fetch failed: ${this.extractKubeError(err)}`,
      );
      return null;
    }
  }
}

// Pure so it's unit-testable without a cluster. The scheduler packs by
// requests, so free slots per node = floor(min(freeCpu, freeMem) / slot).
export function computeClusterCapacity(
  nodes: V1Node[],
  pods: V1Pod[],
): IClusterCapacity {
  const requestsByNode = new Map<string, { cpuMilli: number; memBytes: number }>();
  let usedAgentSlots = 0;

  for (const pod of pods) {
    if (
      pod.metadata?.labels?.[AGENT_POD_LABEL_KEY] === AGENT_POD_LABEL_VALUE
    ) {
      usedAgentSlots += 1;
    }
    // Unscheduled (Pending) pods hold no node capacity yet.
    const nodeName = pod.spec?.nodeName;
    if (!nodeName) continue;

    const req = effectivePodRequests(pod);
    const acc = requestsByNode.get(nodeName) ?? { cpuMilli: 0, memBytes: 0 };
    acc.cpuMilli += req.cpuMilli;
    acc.memBytes += req.memBytes;
    requestsByNode.set(nodeName, acc);
  }

  const nodeCapacities: INodeCapacity[] = nodes
    .filter(isSchedulableAgentNode)
    .map((node) => {
      const name = node.metadata?.name ?? '';
      const allocCpu = parseCpuToMilli(node.status?.allocatable?.cpu) ?? 0;
      const allocMem = parseMemoryToBytes(node.status?.allocatable?.memory) ?? 0;
      const used = requestsByNode.get(name) ?? { cpuMilli: 0, memBytes: 0 };
      const freeCpuMilli = allocCpu - used.cpuMilli;
      const freeMemBytes = allocMem - used.memBytes;
      const freeSlots = Math.max(
        0,
        Math.floor(
          Math.min(
            freeCpuMilli / AGENT_SLOT_CPU_MILLI,
            freeMemBytes / AGENT_SLOT_MEM_BYTES,
          ),
        ),
      );
      return { name, freeCpuMilli, freeMemBytes, freeSlots };
    });

  const freeAgentSlots = nodeCapacities.reduce((sum, n) => sum + n.freeSlots, 0);

  return {
    freeAgentSlots,
    usedAgentSlots,
    totalAgentSlots: usedAgentSlots + freeAgentSlots,
    slotCpuMilli: AGENT_SLOT_CPU_MILLI,
    slotMemBytes: AGENT_SLOT_MEM_BYTES,
    nodes: nodeCapacities,
    observedAt: new Date().toISOString(),
  };
}

// A node counts only if the agent pod could actually land there: labeled for
// the agent pool, not cordoned, and carrying no taint the pod doesn't
// tolerate (which excludes not-ready/pressure taints without a separate
// Ready-condition check).
function isSchedulableAgentNode(node: V1Node): boolean {
  if (
    node.metadata?.labels?.[AGENT_NODE_LABEL_KEY] !== AGENT_NODE_LABEL_VALUE
  ) {
    return false;
  }
  if (node.spec?.unschedulable) return false;
  return (node.spec?.taints ?? []).every(
    (t) =>
      t.effect === 'PreferNoSchedule' ||
      (t.key === TOLERATED_TAINT.key &&
        t.value === TOLERATED_TAINT.value &&
        t.effect === TOLERATED_TAINT.effect),
  );
}

// Scheduler formula: max(sum of app containers, max single init container).
function effectivePodRequests(pod: V1Pod): {
  cpuMilli: number;
  memBytes: number;
} {
  let cpuMilli = 0;
  let memBytes = 0;
  for (const c of pod.spec?.containers ?? []) {
    cpuMilli += parseCpuToMilli(c.resources?.requests?.cpu) ?? 0;
    memBytes += parseMemoryToBytes(c.resources?.requests?.memory) ?? 0;
  }
  for (const c of pod.spec?.initContainers ?? []) {
    cpuMilli = Math.max(cpuMilli, parseCpuToMilli(c.resources?.requests?.cpu) ?? 0);
    memBytes = Math.max(
      memBytes,
      parseMemoryToBytes(c.resources?.requests?.memory) ?? 0,
    );
  }
  return { cpuMilli, memBytes };
}

// Kubernetes resource quantity parsers — handles the forms the agent manifest
// and the metrics API emit. Not a full spec implementation; just enough for
// CPU (cores/m/n/u) and memory (decimal + binary suffixes).
function parseCpuToMilli(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/.exec(value);
  if (!match) return null;
  const num = parseFloat(match[1]);
  switch (match[2]) {
    case '':
      return Math.round(num * 1000);
    case 'm':
      return Math.round(num);
    case 'u':
      return Math.round(num / 1000);
    case 'n':
      return Math.round(num / 1_000_000);
    default:
      return null;
  }
}

function parseMemoryToBytes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)([a-zA-Z]*)$/.exec(value);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const SUFFIX: Record<string, number> = {
    '': 1,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
  };
  const mult = SUFFIX[match[2]];
  if (mult === undefined) return null;
  return Math.round(num * mult);
}
