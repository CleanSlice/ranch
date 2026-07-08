import { IRlmContextRef, IRlmJobResult } from './rlm.types';

export interface IRlmModelSpec {
  provider: string;
  model: string;
  fallbackModel: string;
  apiKey: string;
}

export interface IRlmJobInput {
  jobId: string;
  question: string;
  contextRefs: IRlmContextRef[];
  maxIterations: number;
  timeoutS: number;
  root: IRlmModelSpec;
  sub: IRlmModelSpec;
  ranchApiUrl: string;
  rlmJobToken: string;
  image: string;
  imagePullPolicy: string;
}

// Submits and awaits a single RLM run in a short-lived Argo Job pod (see
// data/rlm-job.manifest.ts). Mirrors IWorkflowGateway's submit/status shape
// but is synchronous from the caller's point of view — a tool call is
// waiting on the answer, there's no "check back later" UX for this.
export abstract class IRlmExecutorGateway {
  abstract submit(input: IRlmJobInput): Promise<string>;
  // jobId is needed alongside workflowName because the answer isn't read
  // from the Argo workflow's own step logs (those belong to the executor
  // pod wrapping the `resource: create` action, not the Job it created) —
  // it's read from the Job's own pod, found via the `ranch/job-id` label.
  abstract awaitResult(
    workflowName: string,
    jobId: string,
    timeoutMs: number,
  ): Promise<IRlmJobResult>;
}
