import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { IInfraConfigGateway } from '#/setting/domain';
import {
  IRlmExecutorGateway,
  IRlmJobInput,
} from '../domain/rlm-executor.gateway';
import { IRlmJobResult } from '../domain/rlm.types';
import {
  buildRlmJobWorkflow,
  RLM_JOB_ID_LABEL,
} from './rlm-job.manifest';

const POLL_INTERVAL_MS = 2_000;

@Injectable()
export class RlmExecutorGateway
  extends IRlmExecutorGateway
  implements OnModuleInit
{
  private readonly logger = new Logger(RlmExecutorGateway.name);
  private coreApi!: CoreV1Api;

  constructor(private readonly infraConfig: IInfraConfigGateway) {
    super();
  }

  onModuleInit(): void {
    // On-demand read-only client (no watch) - same KubeConfig source as
    // KubePodGateway, but this gateway never needs to stay subscribed.
    const kc = new KubeConfig();
    kc.loadFromDefault();
    this.coreApi = kc.makeApiClient(CoreV1Api);
  }

  async submit(input: IRlmJobInput): Promise<string> {
    const workflow = buildRlmJobWorkflow(input);
    const argoUrl = await this.infraConfig.getArgoUrl();

    const response = await fetch(`${argoUrl}/api/v1/workflows/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to submit RLM job: ${error}`);
      throw new Error(`Failed to submit RLM job: ${response.statusText}`);
    }

    const result = await response.json();
    return result.metadata.name;
  }

  async awaitResult(
    workflowName: string,
    jobId: string,
    timeoutMs: number,
  ): Promise<IRlmJobResult> {
    const argoUrl = await this.infraConfig.getArgoUrl();
    const namespace = await this.infraConfig.getAgentsNamespace();
    const deadline = Date.now() + timeoutMs;

    let phase = 'Pending';
    while (Date.now() < deadline) {
      const response = await fetch(
        `${argoUrl}/api/v1/workflows/agents/${workflowName}`,
      );
      if (response.ok) {
        const data = await response.json();
        phase = data.status?.phase ?? phase;
        if (phase === 'Succeeded' || phase === 'Failed' || phase === 'Error') {
          break;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (phase !== 'Succeeded' && phase !== 'Failed' && phase !== 'Error') {
      return {
        answer: '',
        iterations: 0,
        toolCalls: 0,
        durationMs: timeoutMs,
        error: `RLM job timed out waiting for workflow ${workflowName} (last phase: ${phase})`,
      };
    }

    // The answer lives in the Job's own pod stdout, not the Argo workflow
    // step log (that belongs to the `resource: create` executor, not the
    // Job it created) - find it by the label every RLM pod carries.
    const podsRes = await this.coreApi.listNamespacedPod({
      namespace,
      labelSelector: `${RLM_JOB_ID_LABEL}=${jobId}`,
    });
    const pod = podsRes.items?.[0];
    if (!pod?.metadata?.name) {
      return {
        answer: '',
        iterations: 0,
        toolCalls: 0,
        durationMs: timeoutMs,
        error: `RLM job pod not found for job ${jobId} (workflow ${workflowName} phase: ${phase})`,
      };
    }

    let logText: string;
    try {
      logText = await this.coreApi.readNamespacedPodLog({
        name: pod.metadata.name,
        namespace,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        answer: '',
        iterations: 0,
        toolCalls: 0,
        durationMs: timeoutMs,
        error: `Failed to read RLM job pod logs: ${message}`,
      };
    }

    return parseLastJsonLine(logText, phase);
  }
}

function parseLastJsonLine(logText: string, phase: string): IRlmJobResult {
  const lines = logText.trim().split('\n').filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return {
      answer: '',
      iterations: 0,
      toolCalls: 0,
      durationMs: 0,
      error: `RLM job produced no output (phase: ${phase})`,
    };
  }
  try {
    return JSON.parse(lastLine) as IRlmJobResult;
  } catch {
    return {
      answer: '',
      iterations: 0,
      toolCalls: 0,
      durationMs: 0,
      error: `RLM job output was not valid JSON (phase: ${phase}): ${lastLine.slice(0, 500)}`,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
