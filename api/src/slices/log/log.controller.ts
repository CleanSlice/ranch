import { Controller, Get, Param, NotFoundException, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { IAgentGateway } from '#/agent/agent/domain';

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
  private readonly coreApi: CoreV1Api;
  private readonly namespace: string;

  constructor(private agentGateway: IAgentGateway) {
    const kc = new KubeConfig();
    kc.loadFromDefault();

    // In-cluster the apiserver uses k3s's self-signed CA. It's mounted at
    // /var/run/secrets/kubernetes.io/serviceaccount/ca.crt; the deployment
    // exposes it via NODE_EXTRA_CA_CERTS so Node's global TLS stack trusts
    // it. For local dev / kubeconfigs without embedded CA, set KUBE_INSECURE=true
    // to bypass verification (never enable in prod).
    if (process.env.KUBE_INSECURE === 'true') {
      const current = kc.getCurrentCluster();
      if (current) {
        kc.clusters = kc.clusters.map((c) =>
          c.name === current.name ? { ...c, skipTLSVerify: true } : c,
        );
      }
    }

    this.coreApi = kc.makeApiClient(CoreV1Api);
    this.namespace = process.env.AGENTS_NAMESPACE || 'agents';
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

    try {
      const logs = await this.coreApi.readNamespacedPodLog({
        name: podName,
        namespace: this.namespace,
        tailLines,
        timestamps: false,
      });
      // SDK returns the raw log string.
      return { logs: typeof logs === 'string' ? logs : String(logs ?? '') };
    } catch (err) {
      const message = this.extractKubeError(err);
      this.logger.warn(`log fetch failed for ${podName}: ${message}`);
      return { logs: `[log fetch failed: ${message}]` };
    }
  }

  private parseTail(raw?: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 500;
    return Math.min(n, 5000);
  }

  private extractKubeError(err: unknown): string {
    if (!err || typeof err !== 'object') return String(err);
    const e = err as { body?: { message?: string }; statusCode?: number; message?: string };
    if (e.body?.message) return `${e.statusCode ?? ''} ${e.body.message}`.trim();
    return e.message ?? JSON.stringify(e).slice(0, 200);
  }
}
