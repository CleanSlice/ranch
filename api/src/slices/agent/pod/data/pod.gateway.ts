import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { CoreV1Api, KubeConfig, V1Pod, Watch } from '@kubernetes/client-node';
import { Observable, Subject } from 'rxjs';
import { IPodGateway } from '../domain/pod.gateway';
import { IInfraConfigGateway } from '#/setting/domain';
import {
  IAgentPodEvent,
  IAgentPodStatus,
  PodEventTypes,
  PodPhaseTypes,
} from '../domain/pod.types';

const POD_LABEL_SELECTOR = 'app=ranch-agent';
const AGENT_ID_LABEL = 'ranch/agent-id';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

@Injectable()
export class KubePodGateway
  extends IPodGateway
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(KubePodGateway.name);
  private kc!: KubeConfig;
  private coreApi!: CoreV1Api;
  private namespace!: string;

  private readonly statuses = new Map<string, IAgentPodStatus>();
  private readonly events = new Subject<IAgentPodEvent>();

  private watchRequest: { abort: () => void } | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private destroyed = false;

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
      this.logger.log(
        `Pod resync (${this.namespace}): ${fresh.size} pods — ${added} added, ${modified} modified, ${deleted} deleted`,
      );
    }
  }

  private statusChanged(
    prev: IAgentPodStatus,
    next: IAgentPodStatus,
  ): boolean {
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
    if (!err || typeof err !== 'object') return String(err);
    const e = err as {
      body?: { message?: string };
      statusCode?: number;
      message?: string;
    };
    if (e.body?.message)
      return `${e.statusCode ?? ''} ${e.body.message}`.trim();
    return e.message ?? JSON.stringify(e).slice(0, 200);
  }
}
