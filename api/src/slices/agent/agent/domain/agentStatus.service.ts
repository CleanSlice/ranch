import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  Observable,
  Subscription,
  defer,
  filter,
  from,
  map,
  merge,
  mergeMap,
} from 'rxjs';
import { IAgentGateway } from './agent.gateway';
import { IAgentData } from './agent.types';
import { IPodGateway } from '#/agent/pod/domain';
import { IAgentPodStatus, PodEventTypes } from '#/agent/pod/domain/pod.types';

export interface IAgentStatus {
  agent: IAgentData;
  pod: IAgentPodStatus | null;
}

export type AgentStatusStreamMessage =
  | { type: 'snapshot'; payload: IAgentStatus[] }
  | {
      type: 'event';
      payload: { eventType: PodEventTypes; status: IAgentStatus };
    };

const FAIL_WAITING_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'CreateContainerError',
]);

const LIVE_DB_STATUSES = new Set<string>(['pending', 'deploying', 'running']);

@Injectable()
export class AgentStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentStatusService.name);
  private reconcileSub: Subscription | null = null;

  constructor(
    private readonly agentGateway: IAgentGateway,
    private readonly podGateway: IPodGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    this.reconcileSub = this.podGateway.events$().subscribe({
      next: (evt) => {
        // Pod deletion is not an agent failure signal — it happens during
        // restart (Argo cleanup-old step), manual cleanup, and TTL eviction.
        // The DELETED event payload still carries the pod's last phase
        // (often Failed), so reconciling on it would race with restart and
        // pin the DB back to 'failed' right after deploy() set 'deploying'.
        if (evt.type === 'deleted') return;
        void this.reconcileDbStatus(evt.status).catch((err) => {
          this.logger.warn(
            `Reconcile failed for agent ${evt.status.agentId}: ${(err as Error).message}`,
          );
        });
      },
    });

    // Pod gateway has already finished its initial list (it's a dependency
    // of this module). Walk the joined view once at boot to catch agents
    // whose pod vanished while the API was down — those won't ever produce
    // a watch event so the per-event reconciler can't see them.
    try {
      await this.detectStartupDrift();
    } catch (err) {
      this.logger.warn(
        `Startup drift detection failed: ${(err as Error).message}`,
      );
    }
  }

  onModuleDestroy(): void {
    this.reconcileSub?.unsubscribe();
    this.reconcileSub = null;
  }

  async snapshot(): Promise<IAgentStatus[]> {
    const [agents, pods] = await Promise.all([
      this.agentGateway.findAll(),
      this.podGateway.list(),
    ]);
    const podByAgent = new Map(pods.map((p) => [p.agentId, p]));
    return agents.map((agent) => ({
      agent,
      pod: podByAgent.get(agent.id) ?? null,
    }));
  }

  stream$(): Observable<AgentStatusStreamMessage> {
    const initial$ = defer(() => from(this.snapshot())).pipe(
      map<IAgentStatus[], AgentStatusStreamMessage>((payload) => ({
        type: 'snapshot',
        payload,
      })),
    );

    const updates$ = this.podGateway.events$().pipe(
      mergeMap((evt) =>
        from(this.agentGateway.findById(evt.status.agentId)).pipe(
          map((agent): AgentStatusStreamMessage | null =>
            agent
              ? {
                  type: 'event',
                  payload: {
                    eventType: evt.type,
                    status: {
                      agent,
                      pod: evt.type === 'deleted' ? null : evt.status,
                    },
                  },
                }
              : null,
          ),
        ),
      ),
      filter((msg): msg is AgentStatusStreamMessage => msg !== null),
    );

    return merge(initial$, updates$);
  }

  private async detectStartupDrift(): Promise<void> {
    const [agents, pods] = await Promise.all([
      this.agentGateway.findAll(),
      this.podGateway.list(),
    ]);
    const podByAgent = new Map(pods.map((p) => [p.agentId, p]));

    let driftCount = 0;
    let podReconcileCount = 0;

    for (const agent of agents) {
      const pod = podByAgent.get(agent.id);
      if (!pod) {
        if (LIVE_DB_STATUSES.has(agent.status) && agent.status !== 'failed') {
          this.logger.warn(
            `Drift: agent ${agent.id} (${agent.name}) is ${agent.status} in DB but no pod exists — marking failed`,
          );
          await this.agentGateway.updateStatus(
            agent.id,
            'failed',
            agent.workflowId ?? undefined,
          );
          driftCount += 1;
        }
        continue;
      }

      // Pod exists — let the normal reconciler check Failed / CrashLoopBackOff
      // etc. Bootstrap reads pods via list() and bypasses events$, so without
      // this pass an already-failed pod found at boot wouldn't flip the DB row.
      await this.reconcileDbStatus(pod);
      if (pod.phase === 'Failed') podReconcileCount += 1;
    }

    this.logger.log(
      `Startup drift check: ${agents.length} agents, ${pods.length} pods, ${driftCount} marked failed (missing pod), ${podReconcileCount} pods already in Failed`,
    );
  }

  private async reconcileDbStatus(podStatus: IAgentPodStatus): Promise<void> {
    const agent = await this.agentGateway.findById(podStatus.agentId);
    if (!agent) return;

    const isFailed =
      podStatus.phase === 'Failed' ||
      (podStatus.containerWaitingReason !== null &&
        FAIL_WAITING_REASONS.has(podStatus.containerWaitingReason));

    if (isFailed) {
      if (agent.status !== 'failed') {
        this.logger.warn(
          `Reconciling agent ${agent.id}: pod ${podStatus.podName} is ${podStatus.phase}` +
            (podStatus.containerWaitingReason
              ? ` (${podStatus.containerWaitingReason})`
              : '') +
            ` — marking failed`,
        );
        await this.agentGateway.updateStatus(
          agent.id,
          'failed',
          agent.workflowId ?? undefined,
        );
      }
      return;
    }

    // Forward path: when the pod is Running+Ready, lift the DB out of
    // pending/deploying/failed so the UI reflects reality without waiting
    // for someone to GET /agents/:id (which is the only other place that
    // calls syncStatus).
    if (
      podStatus.phase === 'Running' &&
      podStatus.ready &&
      agent.status !== 'running'
    ) {
      this.logger.log(
        `Reconciling agent ${agent.id}: pod ${podStatus.podName} is Running+Ready — marking running`,
      );
      await this.agentGateway.updateStatus(
        agent.id,
        'running',
        agent.workflowId ?? undefined,
      );
    }
  }
}
