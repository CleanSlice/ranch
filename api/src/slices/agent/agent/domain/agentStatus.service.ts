import {
  forwardRef,
  Inject,
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
import { AgentDeployService } from './agentDeploy.service';
import { DeployTracker } from './deployTracker';
import { IPodGateway } from '#/agent/pod/domain';
import { IAgentPodStatus, PodEventTypes } from '#/agent/pod/domain/pod.types';
import { IBridleGateway } from '#/bridle/domain';

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

const DRIFT_INTERVAL_MS = 30_000;
const AUTO_RESTART_CONCURRENCY = 5;

@Injectable()
export class AgentStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentStatusService.name);
  private reconcileSub: Subscription | null = null;
  private bridleSub: Subscription | null = null;
  private driftTimer: NodeJS.Timeout | null = null;
  private driftRunning = false;

  constructor(
    private readonly agentGateway: IAgentGateway,
    private readonly podGateway: IPodGateway,
    private readonly agentDeployService: AgentDeployService,
    private readonly deployTracker: DeployTracker,
    // forwardRef: BridleModule also imports AgentModule (via forwardRef) for
    // AuthService access; same dependency cycle, same workaround.
    @Inject(forwardRef(() => IBridleGateway))
    private readonly bridleGateway: IBridleGateway,
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

    // Primary "agent is up" signal. The runtime opens its bridle WS inside
    // `runtime.start()` — BEFORE Bun.serve binds port 3000 — so this event
    // fires before the K8s readiness probe ever has a chance to pass. If the
    // runtime then hangs or crashes between bridle-connect and Bun.serve, the
    // pod-event reconciler still catches it via Failed/CrashLoopBackOff.
    this.bridleSub = this.bridleGateway.agentEvents$().subscribe({
      next: (evt) => {
        if (evt.type !== 'connected') return;
        void this.markRunningFromBridle(evt.agentId).catch((err) => {
          this.logger.warn(
            `Bridle-driven reconcile failed for agent ${evt.agentId}: ${(err as Error).message}`,
          );
        });
      },
    });

    try {
      const driftFailed = await this.detectDrift('startup');
      if (driftFailed.length > 0) {
        // Don't await — restart is fire-and-forget so onModuleInit doesn't
        // block API boot on N parallel workflow submits. Failures are logged
        // inside the worker.
        void this.autoRestartDriftFailed(driftFailed);
      }
    } catch (err) {
      this.logger.warn(
        `Startup drift detection failed: ${(err as Error).message}`,
      );
    }

    // Safety net for K8s watch missing transitions (no-resourceVersion
    // reconnects, silent stream stalls, transient apiserver hiccups). Calls
    // gateway.resync() which refreshes the cache from K8s and re-emits diff
    // events — those flow through the reconciler. Then we sweep for agents
    // whose pods vanished entirely (events alone don't catch DB-only drift).
    this.driftTimer = setInterval(() => {
      void this.detectDrift('periodic').catch((err) => {
        this.logger.warn(
          `Periodic drift detection failed: ${(err as Error).message}`,
        );
      });
    }, DRIFT_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.reconcileSub?.unsubscribe();
    this.reconcileSub = null;
    this.bridleSub?.unsubscribe();
    this.bridleSub = null;
    if (this.driftTimer) {
      clearInterval(this.driftTimer);
      this.driftTimer = null;
    }
  }

  // Bridle-driven path: the runtime announced itself, so it's definitely up.
  // Forward-only — never demotes; pod events handle the failure side.
  private async markRunningFromBridle(agentId: string): Promise<void> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) return;
    if (agent.status === 'running') {
      this.deployTracker.clear(agentId);
      return;
    }
    this.logger.log(
      `Reconciling agent ${agentId}: bridle runtime registered — marking running`,
    );
    await this.agentGateway.updateStatus(
      agentId,
      'running',
      agent.workflowId ?? undefined,
    );
    this.deployTracker.clear(agentId);
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

  private async detectDrift(reason: 'startup' | 'periodic'): Promise<string[]> {
    if (this.driftRunning) return [];
    this.driftRunning = true;
    try {
      // Refresh the gateway cache from K8s. This emits diff events for any
      // pods whose state changed since last observation — those flow through
      // the reconciler subscription and update DB rows.
      if (reason === 'periodic') await this.podGateway.resync();

      const [agents, pods] = await Promise.all([
        this.agentGateway.findAll(),
        this.podGateway.list(),
      ]);
      const podByAgent = new Map(pods.map((p) => [p.agentId, p]));

      const driftFailedIds: string[] = [];
      let podReconcileCount = 0;

      for (const agent of agents) {
        // Bridle-truth wins: if the runtime is currently connected, the agent
        // IS up regardless of what the K8s probe says. Self-heals the case
        // where the bridle 'connected' event fired before AgentStatusService
        // subscribed (e.g., during an API restart) — the event would be
        // lost otherwise. We skip the pod checks below because a transient
        // pod-missing/Failed state during a restart shouldn't override a
        // healthy runtime that's actively talking to us.
        if (this.bridleGateway.isAgentConnected(agent.id)) {
          if (agent.status !== 'running') {
            this.logger.log(
              `Drift: agent ${agent.id} (${agent.name}) is ${agent.status} in DB but bridle has it registered — marking running`,
            );
            await this.agentGateway.updateStatus(
              agent.id,
              'running',
              agent.workflowId ?? undefined,
            );
            this.deployTracker.clear(agent.id);
          }
          continue;
        }

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
            driftFailedIds.push(agent.id);
          }
          continue;
        }

        // Startup must reconcile inline since events$ is a Subject (no
        // replay) and our subscription happens after the gateway's bootstrap.
        // Periodic relies on resync()'s diff events instead — defensive
        // reconciliation here would race with deploy(): a stale Failed pod
        // still in cache (Argo's cleanup-old hasn't yet deleted it) would
        // overwrite the freshly-set 'deploying' back to 'failed'.
        if (reason === 'startup') {
          await this.reconcileDbStatus(pod);
        }
        if (pod.phase === 'Failed') podReconcileCount += 1;
      }

      if (reason === 'startup' || driftFailedIds.length > 0) {
        this.logger.log(
          `Drift check (${reason}): ${agents.length} agents, ${pods.length} pods, ${driftFailedIds.length} marked failed (missing pod), ${podReconcileCount} pods in Failed`,
        );
      }

      return driftFailedIds;
    } finally {
      this.driftRunning = false;
    }
  }

  // Re-deploys agents that drift detection just marked `failed` because their
  // pod vanished — typically: API was down while K8s lost the pods, or local
  // dev cluster (Docker) was stopped and restarted. We only auto-restart this
  // specific failure class — agents that crashed in real CrashLoopBackOff are
  // left for the operator to inspect (restarting them just spams the cluster).
  private async autoRestartDriftFailed(agentIds: string[]): Promise<void> {
    this.logger.log(
      `Auto-restart: queueing ${agentIds.length} drift-failed agent(s) at concurrency ${AUTO_RESTART_CONCURRENCY}`,
    );

    let index = 0;
    let succeeded = 0;
    let failed = 0;

    const worker = async (): Promise<void> => {
      while (index < agentIds.length) {
        const id = agentIds[index++];
        try {
          await this.agentDeployService.deploy(id);
          succeeded += 1;
        } catch (err) {
          failed += 1;
          this.logger.warn(
            `Auto-restart failed for agent ${id}: ${(err as Error).message}`,
          );
        }
      }
    };

    const workerCount = Math.min(AUTO_RESTART_CONCURRENCY, agentIds.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    this.logger.log(
      `Auto-restart finished: ${succeeded} redeployed, ${failed} failed`,
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
      // Stale failure from the OLD pod during a restart — Argo cancels the
      // previous workflow, kubelet flips its pod to Failed, the watch emits a
      // MODIFIED event. Without this skip the DB toggles to 'failed' between
      // deploy()'s setStatus('deploying') and the new pod going Running+Ready.
      if (this.deployTracker.isStale(agent.id, podStatus.startedAt)) {
        this.logger.debug(
          `Skipping stale Failed event for agent ${agent.id} pod ${podStatus.podName} — predates current deploy`,
        );
        return;
      }
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
      agent.status !== 'running' &&
      // Ignore a Running+Ready event from a pod that predates the current
      // deploy/stop. Without this, the OLD pod's last Running event (still in
      // flight while Argo tears it down) could revert a freshly 'stopped' agent
      // back to 'running', or mask a restart's new pod with the old one.
      !this.deployTracker.isStale(agent.id, podStatus.startedAt)
    ) {
      this.logger.log(
        `Reconciling agent ${agent.id}: pod ${podStatus.podName} is Running+Ready — marking running`,
      );
      await this.agentGateway.updateStatus(
        agent.id,
        'running',
        agent.workflowId ?? undefined,
      );
      // The new pod has stabilised — drop the cutoff so any genuine future
      // failure on this pod is processed normally.
      this.deployTracker.clear(agent.id);
    }
  }
}
