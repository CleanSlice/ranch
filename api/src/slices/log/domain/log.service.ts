import { Injectable, Logger } from '@nestjs/common';
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import {
  formatKubeError,
  kubeErrorCode,
  kubeErrorMessage,
} from '#/agent/pod/domain/kubeError';
import { IInfraConfigGateway } from '#/setting/domain';
import type { IPodLogRead } from './log.types';

/** Tail the console gets when it asks for nothing sensible, and the ceiling. */
export const DEFAULT_TAIL_LINES = 500;
export const MAX_TAIL_LINES = 5000;

/**
 * Agent-pod logs, read once for the console (`LogController`) and the chat
 * (`LogTool`, CLEAN-109) so the two never drift on what "no pod" looks like.
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
@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name);
  private kubeContext: { coreApi: CoreV1Api; namespace: string } | null = null;

  constructor(private infraConfig: IInfraConfigGateway) {}

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

  /** A `?tail=` query (or a tool argument) into a line count within bounds. */
  parseTail(raw?: string | number): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_TAIL_LINES;
    return Math.min(Math.floor(n), MAX_TAIL_LINES);
  }

  /**
   * The last `tailLines` of the agent's pod. `agentStatus` only names the
   * agent's state in the "no pod" marker, as the console shows it.
   */
  async readPodLogs(
    agentId: string,
    agentStatus: string,
    tailLines: number,
  ): Promise<IPodLogRead> {
    const podName = `agent-${agentId}`;
    const { coreApi, namespace } = await this.getKubeContext();

    try {
      // timestamps: K8s prefixes every line with `<RFC3339Nano-ts> ` (0–9
      // fraction digits, `Z` zone) — the admin parses it out client-side for
      // day grouping and a per-line time column. The `[...]` marker responses
      // below intentionally stay timestamp-less so the frontend can tell them
      // apart from real log lines.
      const logs = await coreApi.readNamespacedPodLog({
        name: podName,
        namespace,
        tailLines,
        timestamps: true,
      });
      // SDK returns the raw log string.
      return {
        state: 'logs',
        logs: typeof logs === 'string' ? logs : String(logs ?? ''),
      };
    } catch (err) {
      // 404 is the normal "no pod" state (agent pending/deploying/stopped/failed)
      // and the admin polls this every 5s — keep it silent. Real failures
      // (RBAC, network, etc.) still surface as warnings.
      if (this.isNotFound(err)) {
        return {
          state: 'no_pod',
          logs: `[no pod yet for ${agentStatus} agent]`,
        };
      }
      // 400 BadRequest with "is waiting to start: ContainerCreating /
      // PodInitializing / …" — pod exists but the container hasn't booted
      // yet. Transient (2–15s during restart while kubelet pulls image and
      // mounts volumes). The raw K8s 400 looks scary in the UI, so report a
      // friendly "container starting" line that the frontend can detect.
      const waitingReason = this.extractWaitingReason(err);
      if (waitingReason) {
        return {
          state: 'waiting',
          logs: `[container ${waitingReason.toLowerCase()}]`,
        };
      }
      const message = formatKubeError(err);
      this.logger.warn(`log fetch failed for ${podName}: ${message}`);
      return { state: 'failed', logs: `[log fetch failed: ${message}]` };
    }
  }

  private isNotFound(err: unknown): boolean {
    return kubeErrorCode(err) === 404;
  }

  // K8s returns 400 BadRequest with a body like:
  //   container "agent" in pod "…" is waiting to start: ContainerCreating
  // The reason after "is waiting to start: " is what we want for the UI.
  // Same shape covers PodInitializing, CreateContainerConfigError, etc.
  // kubeErrorMessage handles both body shapes the k8s SDK produces (parsed
  // object vs raw JSON string); the ApiException `message` dump is the last
  // resort so this branch can never silently fall through to the raw error.
  private extractWaitingReason(err: unknown): string | null {
    if (kubeErrorCode(err) !== 400) return null;
    const msg =
      kubeErrorMessage(err) ?? ((err as { message?: string })?.message || '');
    const match = msg.match(/is waiting to start:\s*([A-Za-z0-9_]+)/);
    return match?.[1] ?? null;
  }
}
