import { Injectable, Logger } from '@nestjs/common';
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { IPodGateway } from '../domain';

@Injectable()
export class KubePodGateway extends IPodGateway {
  private readonly logger = new Logger(KubePodGateway.name);
  private readonly coreApi: CoreV1Api;
  private readonly namespace: string;

  constructor() {
    super();
    const kc = new KubeConfig();
    kc.loadFromDefault();

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
