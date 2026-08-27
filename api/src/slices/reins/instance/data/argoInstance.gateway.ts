import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { CoreV1Api, KubeConfig, V1Pod } from '@kubernetes/client-node';
import { IInfraConfigGateway } from '#/setting/domain';
import { IPodGateway } from '#/agent/pod/domain';
import {
  IInstanceGateway,
  IProvisionInstanceData,
} from '../domain/instance.gateway';
import { IInstanceStatus, InstanceStateTypes } from '../domain/instance.types';
import {
  buildInstanceWorkflow,
  instanceEndpointOf,
  instancePodName,
  instanceServiceName,
  KNOWLEDGE_ID_LABEL,
  RETRIEVAL_COMPONENT_LABEL,
  RETRIEVAL_COMPONENT_VALUE,
} from './instance.manifest';

@Injectable()
export class ArgoInstanceGateway extends IInstanceGateway {
  private readonly logger = new Logger(ArgoInstanceGateway.name);
  private coreApi: CoreV1Api | null = null;
  private namespace = 'agents';

  constructor(
    private readonly infraConfig: IInfraConfigGateway,
    private readonly pods: IPodGateway,
  ) {
    super();
  }

  async ensureCapacityForNew(): Promise<void> {
    // A retrieval instance reserves exactly one agent slot, so the agent
    // capacity math answers for bases too. Unknown capacity (no cluster
    // signal) does not block creation — the ceiling is a report, not a
    // guess.
    const capacity = await this.pods.getClusterCapacity().catch(() => null);
    if (capacity && capacity.freeAgentSlots < 1) {
      throw new ConflictException(
        `The cluster has no room for another knowledge base: each base runs ` +
          `its own retrieval instance (one agent slot, ` +
          `${capacity.slotCpuMilli}m CPU / ${Math.round(capacity.slotMemBytes / (1024 * 1024))}Mi) ` +
          `and all ${capacity.totalAgentSlots} slots are taken. ` +
          `Free capacity or delete a base first.`,
      );
    }
  }

  // Lazy — unlike the pod gateway this class is also instantiated in mock
  // mode (the router owns the choice), so kube init must not run at boot.
  private async ensureInit(): Promise<CoreV1Api> {
    if (this.coreApi) return this.coreApi;
    const [namespace, skipTls] = await Promise.all([
      this.infraConfig.getAgentsNamespace(),
      this.infraConfig.getKubeSkipTlsVerify(),
    ]);
    this.namespace = namespace;
    const kc = new KubeConfig();
    kc.loadFromDefault();
    if (skipTls) {
      const current = kc.getCurrentCluster();
      if (current) {
        kc.clusters = kc.clusters.map((c) =>
          c.name === current.name ? { ...c, skipTLSVerify: true } : c,
        );
      }
    }
    this.coreApi = kc.makeApiClient(CoreV1Api);
    return this.coreApi;
  }

  async provision(data: IProvisionInstanceData): Promise<IInstanceStatus> {
    const current = await this.status(data.knowledgeId);
    if (current.state === 'ready' || current.state === 'starting') {
      return current;
    }

    const workflow = buildInstanceWorkflow(data);
    const argoUrl = await this.infraConfig.getArgoUrl();
    const response = await fetch(`${argoUrl}/api/v1/workflows/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow }),
    });
    if (!response.ok) {
      const error = await response.text();
      this.logger.error(
        `Instance workflow submit failed for ${data.knowledgeId}: ${error}`,
      );
      throw new Error(
        `Failed to provision retrieval instance: ${response.statusText}`,
      );
    }

    return {
      knowledgeId: data.knowledgeId,
      state: 'starting',
      endpoint: null,
      error: null,
      observedAt: new Date().toISOString(),
    };
  }

  async status(knowledgeId: string): Promise<IInstanceStatus> {
    const api = await this.ensureInit();
    let pod: V1Pod;
    try {
      pod = await api.readNamespacedPod({
        name: instancePodName(knowledgeId),
        namespace: this.namespace,
      });
    } catch (err) {
      if (this.isNotFound(err)) {
        return this.toStatus(knowledgeId, 'absent', null);
      }
      throw err;
    }
    return this.mapPod(knowledgeId, pod);
  }

  async list(): Promise<IInstanceStatus[]> {
    const api = await this.ensureInit();
    const res = await api.listNamespacedPod({
      namespace: this.namespace,
      labelSelector: `${RETRIEVAL_COMPONENT_LABEL}=${RETRIEVAL_COMPONENT_VALUE}`,
    });
    const statuses: IInstanceStatus[] = [];
    for (const pod of res.items ?? []) {
      const knowledgeId = pod.metadata?.labels?.[KNOWLEDGE_ID_LABEL];
      if (!knowledgeId) continue;
      statuses.push(this.mapPod(knowledgeId, pod));
    }
    return statuses;
  }

  async terminate(knowledgeId: string): Promise<void> {
    const api = await this.ensureInit();
    try {
      await api.deleteNamespacedPod({
        name: instancePodName(knowledgeId),
        namespace: this.namespace,
        propagationPolicy: 'Background',
      });
    } catch (err) {
      if (!this.isNotFound(err)) throw err;
    }
    try {
      await api.deleteNamespacedService({
        name: instanceServiceName(knowledgeId),
        namespace: this.namespace,
      });
    } catch (err) {
      if (!this.isNotFound(err)) throw err;
    }
  }

  private mapPod(knowledgeId: string, pod: V1Pod): IInstanceStatus {
    if (pod.metadata?.deletionTimestamp) {
      return this.toStatus(knowledgeId, 'stopping', null);
    }
    const phase = pod.status?.phase;
    const container = pod.status?.containerStatuses?.[0];
    if (phase === 'Running' && container?.ready) {
      return this.toStatus(knowledgeId, 'ready', null);
    }
    if (phase === 'Failed') {
      const reason =
        container?.lastState?.terminated?.reason ??
        pod.status?.message ??
        'pod failed';
      return this.toStatus(knowledgeId, 'failed', reason);
    }
    const waiting = container?.state?.waiting?.reason;
    if (waiting === 'CrashLoopBackOff' || waiting === 'ImagePullBackOff') {
      return this.toStatus(knowledgeId, 'failed', waiting);
    }
    return this.toStatus(knowledgeId, 'starting', null);
  }

  private toStatus(
    knowledgeId: string,
    state: InstanceStateTypes,
    error: string | null,
  ): IInstanceStatus {
    return {
      knowledgeId,
      state,
      endpoint: state === 'ready' ? instanceEndpointOf(knowledgeId) : null,
      error,
      observedAt: new Date().toISOString(),
    };
  }

  private isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { statusCode?: number; code?: number };
    return e.statusCode === 404 || e.code === 404;
  }
}
