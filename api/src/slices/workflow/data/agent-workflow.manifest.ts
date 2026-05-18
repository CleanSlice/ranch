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

export interface IAgentWorkflowManifestInput {
  agentId: string;
  agentName: string;
  templateId: string;
  image: string;
  imagePullPolicy: string;
  cpu: string;
  memory: string;
  isAdmin: boolean;
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
      tolerations: [
        { key: 'workload', value: 'agent', effect: 'NoSchedule' },
      ],
      imagePullSecrets: [{ name: 'ghcr' }],
      containers: [
        {
          name: 'agent',
          image: i.image,
          imagePullPolicy: i.imagePullPolicy,
          env: [
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
            { name: 'RANCH_API_URL', value: i.ranchApiUrl },
            { name: 'RANCH_API_TOKEN', value: i.ranchApiToken },
            { name: 'MCP_SERVERS_B64', value: i.mcpServersB64 },
            { name: 'TELEGRAM_BOT_TOKEN', value: i.telegram.botToken },
            { name: 'TELEGRAM_BOT_NAME', value: i.telegram.botName },
            { name: 'TELEGRAM_BOT_ADMIN_IDS', value: i.telegram.adminIds },
          ],
          resources: {
            requests: { cpu: i.cpu, memory: i.memory },
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
