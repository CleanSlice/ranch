// Builds the Argo Workflow manifest that deploys a single agent pod. Replaces
// the old out-of-band `WorkflowTemplate` (formerly duplicated in
// k8s/templates/agent-workflow.yaml and terraform/.../agent-deployment.yaml.tftpl).
// Now everything lives next to the gateway that submits it.
//
// Because we substitute every value here, the submitted Workflow needs no
// `arguments.parameters` and no `{{workflow.parameters.X}}` placeholders —
// it's a fully-baked manifest. Argo's `resource.manifest` accepts JSON
// (a strict subset of YAML), so the inner pod specs are JSON-stringified
// objects rather than YAML strings with escape hazards.

import type { IAgentEnvVar } from '../domain/workflow.types';

export interface IAgentWorkflowManifestInput {
  agentId: string;
  agentName: string;
  templateId: string;
  image: string;
  imagePullPolicy: string;
  cpu: string;
  memory: string;
  isAdmin: boolean;
  debugEnabled: boolean;
  // Ranch user the agent acts on behalf of when calling
  // /integrations/internal/* — cookies and integrations are user-scoped,
  // the runtime's ranch-session adapter forwards this as
  // RANCH_AGENT_OWNER_ID.
  ownerUserId: string;
  ranchApiUrl: string;
  ranchApiToken: string;
  bridleUrl: string;
  bridleApiKey: string;
  s3Bucket: string;
  s3Prefix: string;
  s3Endpoint: string;
  awsRegion: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  secretProvider: string;
  awsSecretPrefix: string;
  agentConfigB64: string;
  mcpServersB64: string;
  llm: {
    provider: string;
    model: string;
    fallbackModel: string;
    apiKey: string;
    auxProvider: string;
    auxModel: string;
    auxFallbackModel: string;
    auxApiKey: string;
  };
  telegram: {
    botToken: string;
    botName: string;
    adminIds: string;
  };
}

const NAMESPACE = 'agents';
const SERVICE_ACCOUNT = 'workflow';
// Delete Argo's executor pods (*-cleanup-pod-*, *-agent-pod-*) the moment each
// step finishes. The long-running agent pod is a standalone Pod resource (not
// owned by the workflow), so it's unaffected.
const POD_GC_STRATEGY = 'OnPodCompletion';
// Garbage-collect the Workflow object itself an hour after it finishes. Long
// enough to inspect failures with `argo get`, short enough to keep the
// namespace tidy across dozens of restarts.
const WORKFLOW_TTL_SECONDS = 3600;

export function buildAgentWorkflow(input: IAgentWorkflowManifestInput): object {
  const podName = `agent-${input.agentId}`;

  const cleanupManifest = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: podName, namespace: NAMESPACE },
  };

  const agentPodManifest = buildAgentPod(podName, input);

  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Workflow',
    metadata: {
      generateName: `${podName}-`,
      namespace: NAMESPACE,
      labels: {
        'ranch/agent-id': input.agentId,
        'ranch/template-id': input.templateId,
      },
    },
    spec: {
      entrypoint: 'deploy-agent',
      serviceAccountName: SERVICE_ACCOUNT,
      podGC: { strategy: POD_GC_STRATEGY },
      ttlStrategy: { secondsAfterCompletion: WORKFLOW_TTL_SECONDS },
      templates: [
        {
          name: 'deploy-agent',
          steps: [
            [
              {
                name: 'cleanup-old',
                template: 'cleanup-pod',
                continueOn: { failed: true },
              },
            ],
            [{ name: 'run-agent', template: 'agent-pod' }],
          ],
        },
        {
          name: 'cleanup-pod',
          resource: {
            action: 'delete',
            flags: ['--ignore-not-found', '--wait=true', '--timeout=30s'],
            manifest: JSON.stringify(cleanupManifest),
          },
        },
        {
          name: 'agent-pod',
          resource: {
            action: 'create',
            successCondition: 'status.phase == Running',
            // Treat Succeeded as failure: a runtime image with no command (e.g.
            // vanilla `node:18-alpine`) exits with code 0 in <1s, so the pod
            // skips Running and goes straight to Succeeded. Without this,
            // Argo retries the resource watch forever.
            failureCondition: 'status.phase in (Failed, Succeeded)',
            manifest: JSON.stringify(agentPodManifest),
          },
        },
      ],
    },
  };
}

/**
 * The exact env var list injected into an agent pod. SINGLE SOURCE OF
 * TRUTH — `buildAgentPod` uses it for the real pod spec, and the env
 * preview endpoint (`GET /agents/:id/env`) uses it so the admin UI never
 * drifts from what the pod actually gets. Adding an env var here makes
 * it appear in both places automatically.
 */
export function buildAgentEnv(i: IAgentWorkflowManifestInput): IAgentEnvVar[] {
  const entries: IAgentEnvVar[] = [
    { name: 'AGENT_ID', value: i.agentId },
    { name: 'AGENT_NAME', value: i.agentName },
    { name: 'AGENT_CONFIG_B64', value: i.agentConfigB64 },
    { name: 'BRIDLE_URL', value: i.bridleUrl },
    { name: 'BRIDLE_API_KEY', value: i.bridleApiKey },
    { name: 'BRIDLE_AGENT_ID', value: i.agentId },
    { name: 'S3_BUCKET', value: i.s3Bucket },
    { name: 'S3_PREFIX', value: i.s3Prefix },
    { name: 'S3_ENDPOINT', value: i.s3Endpoint },
    { name: 'AWS_REGION', value: i.awsRegion },
    { name: 'AWS_ACCESS_KEY_ID', value: i.awsAccessKeyId },
    { name: 'AWS_SECRET_ACCESS_KEY', value: i.awsSecretAccessKey },
    { name: 'SECRET_PROVIDER', value: i.secretProvider },
    { name: 'AWS_SECRET_PREFIX', value: i.awsSecretPrefix },
    { name: 'LLM_PROVIDER', value: i.llm.provider },
    { name: 'LLM_MODEL', value: i.llm.model },
    { name: 'LLM_FALLBACK_MODEL', value: i.llm.fallbackModel },
    { name: 'LLM_API_KEY', value: i.llm.apiKey },
    { name: 'LLM_AUX_PROVIDER', value: i.llm.auxProvider },
    { name: 'LLM_AUX_MODEL', value: i.llm.auxModel },
    { name: 'LLM_AUX_FALLBACK_MODEL', value: i.llm.auxFallbackModel },
    { name: 'LLM_AUX_API_KEY', value: i.llm.auxApiKey },
    { name: 'RANCH_ADMIN', value: i.isAdmin ? 'true' : 'false' },
    // Debug toggle — `LOG_LEVEL=debug` makes the runtime emit full error
    // traces (the truncated "+N more lines") and the live debug event
    // stream. Off → normal `info` verbosity.
    { name: 'LOG_LEVEL', value: i.debugEnabled ? 'debug' : 'info' },
    { name: 'RANCH_AGENT_OWNER_ID', value: i.ownerUserId },
    { name: 'RANCH_API_URL', value: i.ranchApiUrl },
    { name: 'RANCH_API_TOKEN', value: i.ranchApiToken },
    { name: 'MCP_SERVERS_B64', value: i.mcpServersB64 },
    { name: 'TELEGRAM_BOT_TOKEN', value: i.telegram.botToken },
    { name: 'TELEGRAM_BOT_NAME', value: i.telegram.botName },
    { name: 'TELEGRAM_BOT_ADMIN_IDS', value: i.telegram.adminIds },
  ];
  // Drop empty-valued entries. The pod treats `FOO=""` and `FOO` (unset) as
  // different — `??` on the runtime side keeps the empty string, masking the
  // intended fallback. The classic burn: `LLM_AUX_API_KEY=""` made the
  // runtime's auxiliary Claude init fail with "No credentials" instead of
  // inheriting `LLM_API_KEY`.
  return entries.filter((e) => e.value !== '' && e.value !== undefined);
}

function buildAgentPod(
  podName: string,
  i: IAgentWorkflowManifestInput,
): object {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: NAMESPACE,
      labels: {
        app: 'ranch-agent',
        'ranch/agent-id': i.agentId,
        'ranch/template-id': i.templateId,
      },
    },
    spec: {
      restartPolicy: 'Never',
      nodeSelector: { 'node-role': 'agents' },
      tolerations: [{ key: 'workload', value: 'agent', effect: 'NoSchedule' }],
      imagePullSecrets: [{ name: 'ghcr' }],
      containers: [
        {
          name: 'agent',
          image: i.image,
          imagePullPolicy: i.imagePullPolicy,
          env: buildAgentEnv(i),
          // Burstable QoS: requests are a low floor (so the scheduler can
          // fit many agents per node), limits are what the user configured
          // (so each agent can burst up to its full budget when actually
          // running browser_play / Chromium). Guaranteed (requests == limits
          // at 2 CPU / 2Gi) made schedules fail on small Hetzner nodes —
          // even one agent didn't fit alongside the platform pods.
          //
          // CPU request is 100m, not 500m: idle agents actually use ~10-20m,
          // so 500m × ~14 agents reserved 100% of an 8-vCPU cx43 node while it
          // ran at 8% — new agents stuck Pending on "Insufficient cpu" despite
          // a near-idle node. The scheduler packs by requests, not usage, so
          // an honest low floor is what lets agents fit. Bursting is unaffected
          // (limits still come from i.cpu). Memory floor stays 512Mi — that's
          // a real idle footprint and becomes the next ceiling (~28/node).
          resources: {
            requests: { cpu: '100m', memory: '512Mi' },
            limits: { cpu: i.cpu, memory: i.memory },
          },
          ports: [{ containerPort: 3000 }],
          // Runtime starts Bun.serve AFTER await runtime.start() finishes —
          // channels connected, S3 pulled, loop wired. Probing port 3000 means
          // "agent is actually ready", not just "container PID 1 exists".
          // Without this the API reconciler flips status to 'running' the moment
          // kubelet reports container started.
          startupProbe: {
            httpGet: { path: '/', port: 3000 },
            periodSeconds: 2,
            failureThreshold: 90,
          },
          readinessProbe: {
            httpGet: { path: '/', port: 3000 },
            periodSeconds: 5,
            failureThreshold: 3,
          },
        },
      ],
    },
  };
}
