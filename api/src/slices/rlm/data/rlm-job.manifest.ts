// Builds the Argo Workflow manifest that runs a single, disposable RLM
// executor pod. Mirrors workflow/data/agent-workflow.manifest.ts's shape
// (fully-baked manifest, no {{workflow.parameters}}) but wraps a batch/v1
// Job instead of a bare Pod - a Job gives free backoffLimit /
// activeDeadlineSeconds / ttlSecondsAfterFinished semantics that fit a
// genuinely one-shot, non-retryable run.

import type { IRlmJobInput } from '../domain/rlm-executor.gateway';

const NAMESPACE = 'agents';
const SERVICE_ACCOUNT = 'workflow';
// Distinct, zero-RBAC SA for the pod the Job spawns (see
// k8s/templates/rlm-job-rbac.yaml) - it never calls the k8s API itself.
const JOB_SERVICE_ACCOUNT = 'rlm-job';
// Matches k8s/templates/rlm-job-networkpolicy.yaml's podSelector.
export const RLM_JOB_POD_LABEL = 'app';
export const RLM_JOB_POD_LABEL_VALUE = 'ranch-rlm-job';
export const RLM_JOB_ID_LABEL = 'ranch/job-id';
const WORKFLOW_TTL_SECONDS = 3600;

interface IRlmEnvVar {
  name: string;
  value: string;
}

export function buildRlmJobWorkflow(input: IRlmJobInput): object {
  const jobName = `rlm-${input.jobId}`;
  const jobManifest = buildRlmJob(jobName, input);

  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Workflow',
    metadata: {
      generateName: `${jobName}-`,
      namespace: NAMESPACE,
      labels: { [RLM_JOB_ID_LABEL]: input.jobId },
    },
    spec: {
      entrypoint: 'run-rlm-job',
      serviceAccountName: SERVICE_ACCOUNT,
      ttlStrategy: { secondsAfterCompletion: WORKFLOW_TTL_SECONDS },
      templates: [
        {
          name: 'run-rlm-job',
          resource: {
            action: 'create',
            successCondition: 'status.succeeded > 0',
            failureCondition: 'status.failed > 0',
            manifest: JSON.stringify(jobManifest),
          },
        },
      ],
    },
  };
}

function buildRlmJob(jobName: string, i: IRlmJobInput): object {
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: NAMESPACE,
      labels: {
        [RLM_JOB_POD_LABEL]: RLM_JOB_POD_LABEL_VALUE,
        [RLM_JOB_ID_LABEL]: i.jobId,
      },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: i.timeoutS,
      ttlSecondsAfterFinished: 300,
      template: {
        metadata: {
          labels: {
            [RLM_JOB_POD_LABEL]: RLM_JOB_POD_LABEL_VALUE,
            [RLM_JOB_ID_LABEL]: i.jobId,
          },
        },
        spec: {
          restartPolicy: 'Never',
          serviceAccountName: JOB_SERVICE_ACCOUNT,
          nodeSelector: { 'node-role': 'agents' },
          tolerations: [
            { key: 'workload', value: 'agent', effect: 'NoSchedule' },
          ],
          imagePullSecrets: [{ name: 'ghcr' }],
          containers: [
            {
              name: 'rlm',
              image: i.image,
              imagePullPolicy: i.imagePullPolicy,
              env: buildRlmJobEnv(i),
              // No browser/Chromium workload here - a bounded tool-call
              // loop over text, far smaller than an agent pod's footprint.
              resources: {
                requests: { cpu: '100m', memory: '256Mi' },
                limits: { cpu: '500m', memory: '512Mi' },
              },
            },
          ],
        },
      },
    },
  };
}

export function buildRlmJobEnv(i: IRlmJobInput): IRlmEnvVar[] {
  const entries: IRlmEnvVar[] = [
    { name: 'RLM_MODE', value: '1' },
    { name: 'RLM_JOB_ID', value: i.jobId },
    { name: 'RLM_QUESTION', value: i.question },
    {
      name: 'RLM_CONTEXT_REFS_B64',
      value: Buffer.from(JSON.stringify(i.contextRefs)).toString('base64'),
    },
    { name: 'RLM_MAX_ITERATIONS', value: String(i.maxIterations) },
    { name: 'RLM_TIMEOUT_S', value: String(i.timeoutS) },
    { name: 'RANCH_API_URL', value: i.ranchApiUrl },
    { name: 'RLM_JOB_TOKEN', value: i.rlmJobToken },
    { name: 'RLM_ROOT_PROVIDER', value: i.root.provider },
    { name: 'RLM_ROOT_MODEL', value: i.root.model },
    { name: 'RLM_ROOT_FALLBACK_MODEL', value: i.root.fallbackModel },
    { name: 'RLM_ROOT_API_KEY', value: i.root.apiKey },
    { name: 'RLM_SUB_PROVIDER', value: i.sub.provider },
    { name: 'RLM_SUB_MODEL', value: i.sub.model },
    { name: 'RLM_SUB_FALLBACK_MODEL', value: i.sub.fallbackModel },
    { name: 'RLM_SUB_API_KEY', value: i.sub.apiKey },
  ];
  // Same rationale as buildAgentEnv: `FOO=""` and unset FOO are different to
  // a `??` fallback on the runtime side - drop empties so defaults kick in.
  return entries.filter((e) => e.value !== '' && e.value !== undefined);
}
