import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Query,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { IAgentGateway } from '#/agent/agent/domain';
import { IInfraConfigGateway } from '#/setting/domain';

/**
 * Agent-pod logs.
 *
 * Reads via the Kubernetes API (not `kubectl` shell-out) so the same code
 * works on two setups:
 *   - Local dev: API runs on host → `KubeConfig.loadFromDefault()` picks up
 *     `~/.kube/config`.
 *   - In-cluster: API runs in a Pod → `loadFromDefault()` auto-detects the
 *     projected ServiceAccount token at
 *     `/var/run/secrets/kubernetes.io/serviceaccount`.
 *
 * Required RBAC: the API's ServiceAccount needs `get` on `pods` and
 * `pods/log` in the agents namespace (see k8s/templates/rbac.yaml).
 */
@ApiTags('logs')
@Controller('agents/:agentId/logs')
export class LogController {
  private readonly logger = new Logger(LogController.name);
  private kubeContext: { coreApi: CoreV1Api; namespace: string } | null = null;

  constructor(
    private agentGateway: IAgentGateway,
    private infraConfig: IInfraConfigGateway,
  ) {}

  private async getKubeContext(): Promise<{
    coreApi: CoreV1Api;
    namespace: string;
  }> {
    if (this.kubeContext) return this.kubeContext;

    const [namespace, skipTls] = await Promise.all([
      this.infraConfig.getAgentsNamespace(),
      this.infraConfig.getKubeSkipTlsVerify(),
    ]);

    const kc = new KubeConfig();
    kc.loadFromDefault();

    // In-cluster the apiserver uses k3s's self-signed CA. It's mounted at
    // /var/run/secrets/kubernetes.io/serviceaccount/ca.crt; the deployment
    // exposes it via NODE_EXTRA_CA_CERTS so Node's global TLS stack trusts
    // it. For local dev / kubeconfigs without embedded CA, enable
    // `infrastructure.kube_skip_tls_verify` to bypass verification.
    if (skipTls) {
      const current = kc.getCurrentCluster();
      if (current) {
        kc.clusters = kc.clusters.map((c) =>
          c.name === current.name ? { ...c, skipTLSVerify: true } : c,
        );
      }
    }

    this.kubeContext = {
      coreApi: kc.makeApiClient(CoreV1Api),
      namespace,
    };
    return this.kubeContext;
  }

  @Get()
  @ApiOperation({ summary: 'Get agent pod logs' })
  async getLogs(
    @Param('agentId') agentId: string,
    @Query('tail') tail?: string,
  ): Promise<{ logs: string }> {
    const agent = await this.agentGateway.findById(agentId);
    if (!agent) throw new NotFoundException('Agent not found');

    const podName = `agent-${agentId}`;
    const tailLines = this.parseTail(tail);
    const { coreApi, namespace } = await this.getKubeContext();

    try {
      const logs = await coreApi.readNamespacedPodLog({
        name: podName,
        namespace,
        tailLines,
        timestamps: false,
      });
      // SDK returns the raw log string.
      return { logs: typeof logs === 'string' ? logs : String(logs ?? '') };
    } catch (err) {
      // 404 is the normal "no pod" state (agent pending/deploying/stopped/failed)
      // and the admin polls this every 5s — keep it silent. Real failures
      // (RBAC, network, etc.) still surface as warnings.
      if (this.isNotFound(err)) {
        return { logs: `[no pod yet for ${agent.status} agent]` };
      }
      // 400 BadRequest with "is waiting to start: ContainerCreating /
      // PodInitializing / …" — pod exists but the container hasn't booted
      // yet. Transient (2–15s during restart while kubelet pulls image and
      // mounts volumes). The raw K8s 400 looks scary in the UI, so report a
      // friendly "container starting" line that the frontend can detect.
      const waitingReason = this.extractWaitingReason(err);
      if (waitingReason) {
        return { logs: `[container ${waitingReason.toLowerCase()}]` };
      }
      const message = this.extractKubeError(err);
      this.logger.warn(`log fetch failed for ${podName}: ${message}`);
      return { logs: `[log fetch failed: ${message}]` };
    }
  }

  private isNotFound(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { statusCode?: number; code?: number };
    return e.statusCode === 404 || e.code === 404;
  }

  // K8s returns 400 BadRequest with a body like:
  //   container "agent" in pod "…" is waiting to start: ContainerCreating
  // The reason after "is waiting to start: " is what we want for the UI.
  // Same shape covers PodInitializing, CreateContainerConfigError, etc.
  private extractWaitingReason(err: unknown): string | null {
    if (!err || typeof err !== 'object') return null;
    const e = err as {
      statusCode?: number;
      code?: number;
      body?: { message?: string };
    };
    const status = e.statusCode ?? e.code;
    if (status !== 400) return null;
    const msg = e.body?.message ?? '';
    const match = msg.match(/is waiting to start:\s*([A-Za-z0-9_]+)/);
    return match?.[1] ?? null;
  }

  private parseTail(raw?: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 500;
    return Math.min(n, 5000);
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
