import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  CoreV1Api,
  KubeConfig,
  V1Pod,
  Watch,
} from '@kubernetes/client-node';
import { Observable, Subject } from 'rxjs';
import { IPodGateway } from '../domain/pod.gateway';
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
  private readonly kc: KubeConfig;
  private readonly coreApi: CoreV1Api;
  private readonly namespace: string;

  private readonly statuses = new Map<string, IAgentPodStatus>();
  private readonly events = new Subject<IAgentPodEvent>();

  private watchRequest: { abort: () => void } | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private destroyed = false;

  constructor() {
    super();
    this.kc = new KubeConfig();
    this.kc.loadFromDefault();

    if (process.env.KUBE_INSECURE === 'true') {
      const current = this.kc.getCurrentCluster();
      if (current) {
        this.kc.clusters = this.kc.clusters.map((c) =>
          c.name === current.name ? { ...c, skipTLSVerify: true } : c,
        );
      }
    }

    this.coreApi = this.kc.makeApiClient(CoreV1Api);
    this.namespace = process.env.AGENTS_NAMESPACE || 'agents';
  }

  async onModuleInit(): Promise<void> {
    await this.bootstrapInitialState();
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

  private async bootstrapInitialState(): Promise<void> {
    try {
      const res = await this.coreApi.listNamespacedPod({
        namespace: this.namespace,
        labelSelector: POD_LABEL_SELECTOR,
      });
      for (const pod of res.items ?? []) {
        const status = this.mapPodStatus(pod);
        if (status) this.statuses.set(status.agentId, status);
      }
      this.logger.log(
        `Bootstrapped ${this.statuses.size} agent pod statuses from ${this.namespace}`,
      );
    } catch (err) {
      this.logger.warn(
        `Initial pod list failed: ${this.extractKubeError(err)} — watch will populate state`,
      );
    }
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
      this.startWatch();
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
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
