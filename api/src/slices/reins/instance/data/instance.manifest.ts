// Builds the Argo Workflow that provisions one knowledge base's retrieval
// instance — a LightRAG pod started with WORKSPACE fixed to that base plus a
// Service for stable in-cluster addressing. Deliberately mirrors
// agent-workflow.manifest.ts: fully-baked JSON, no workflow parameters.

import {
  AGENT_SLOT_CPU_MILLI,
  AGENT_SLOT_MEM_BYTES,
} from '#/agent/pod/domain';

export interface IInstanceManifestInput {
  knowledgeId: string;
  knowledgeName: string;
  workspace: string;
}

// Pinned by digest, never :latest — upstream renames broke this integration
// twice (/documents/url removed, /documents/file -> /documents/upload), and
// with one instance per base an upstream change landing mid-migration would
// break bases unevenly. Digest of :latest resolved 2026-08-27.
export const LIGHTRAG_IMAGE =
  'ghcr.io/hkuds/lightrag@sha256:ab23a9c83a735901b18c8960b6b482b602d5b6291abb7e07c5776f7bb2da504e';

const NAMESPACE = 'agents';
const SERVICE_ACCOUNT = 'workflow';
const POD_GC_STRATEGY = 'OnPodCompletion';
const WORKFLOW_TTL_SECONDS = 3600;
const PORT = 9621;

export const KNOWLEDGE_ID_LABEL = 'ranch/knowledge-id';
export const RETRIEVAL_COMPONENT_LABEL = 'ranch/component';
export const RETRIEVAL_COMPONENT_VALUE = 'retrieval';

// From agents, the platform-namespace postgres needs its full service DNS.
// Credentials are baked into the gzdaniel/postgres-for-rag image as
// rag/rag/rag and cannot be overridden — client side matches.
const POSTGRES_HOST = 'lightrag-postgres.platform.svc.cluster.local';

// The lightrag-api secret must exist in the agents namespace (mirrored from
// platform) — a pod can only reference secrets in its own namespace.
const SECRET_NAME = 'lightrag-api';

export function instancePodName(knowledgeId: string): string {
  return `lightrag-kb-${knowledgeId}`;
}

export function instanceServiceName(knowledgeId: string): string {
  return `lightrag-kb-${knowledgeId}`;
}

export function instanceEndpointOf(knowledgeId: string): string {
  return `http://${instanceServiceName(knowledgeId)}.${NAMESPACE}.svc:${PORT}`;
}

export function buildInstanceWorkflow(input: IInstanceManifestInput): object {
  const podName = instancePodName(input.knowledgeId);

  const cleanupManifest = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: podName, namespace: NAMESPACE },
  };

  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Workflow',
    metadata: {
      generateName: `${podName}-`,
      namespace: NAMESPACE,
      labels: {
        [KNOWLEDGE_ID_LABEL]: input.knowledgeId,
        [RETRIEVAL_COMPONENT_LABEL]: RETRIEVAL_COMPONENT_VALUE,
      },
    },
    spec: {
      entrypoint: 'deploy-instance',
      serviceAccountName: SERVICE_ACCOUNT,
      podGC: { strategy: POD_GC_STRATEGY },
      ttlStrategy: { secondsAfterCompletion: WORKFLOW_TTL_SECONDS },
      templates: [
        {
          name: 'deploy-instance',
          steps: [
            [
              {
                name: 'cleanup-old',
                template: 'cleanup-pod',
                continueOn: { failed: true },
              },
            ],
            [{ name: 'ensure-service', template: 'instance-service' }],
            [{ name: 'run-instance', template: 'instance-pod' }],
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
          name: 'instance-service',
          resource: {
            action: 'apply',
            manifest: JSON.stringify(buildInstanceService(input)),
          },
        },
        {
          name: 'instance-pod',
          resource: {
            action: 'create',
            successCondition: 'status.phase == Running',
            failureCondition: 'status.phase in (Failed, Succeeded)',
            manifest: JSON.stringify(buildInstancePod(input)),
          },
        },
      ],
    },
  };
}

export function buildInstanceService(input: IInstanceManifestInput): object {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: instanceServiceName(input.knowledgeId),
      namespace: NAMESPACE,
      labels: {
        [KNOWLEDGE_ID_LABEL]: input.knowledgeId,
        [RETRIEVAL_COMPONENT_LABEL]: RETRIEVAL_COMPONENT_VALUE,
      },
    },
    spec: {
      selector: { [KNOWLEDGE_ID_LABEL]: input.knowledgeId },
      ports: [{ port: PORT, targetPort: PORT }],
    },
  };
}

export function buildInstancePod(input: IInstanceManifestInput): object {
  const secretEnv = (name: string, key: string) => ({
    name,
    valueFrom: { secretKeyRef: { name: SECRET_NAME, key } },
  });

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: instancePodName(input.knowledgeId),
      namespace: NAMESPACE,
      labels: {
        app: 'lightrag-kb',
        [KNOWLEDGE_ID_LABEL]: input.knowledgeId,
        [RETRIEVAL_COMPONENT_LABEL]: RETRIEVAL_COMPONENT_VALUE,
      },
      annotations: { 'ranch/knowledge-name': input.knowledgeName },
    },
    spec: {
      restartPolicy: 'Always',
      nodeSelector: { 'node-role': 'agents' },
      tolerations: [{ key: 'workload', value: 'agent', effect: 'NoSchedule' }],
      containers: [
        {
          name: 'lightrag',
          image: LIGHTRAG_IMAGE,
          ports: [{ containerPort: PORT }],
          env: [
            secretEnv('LIGHTRAG_API_KEY', 'apiKey'),
            { name: 'WORKSPACE', value: input.workspace },
            { name: 'LLM_BINDING', value: 'openai' },
            { name: 'LLM_MODEL', value: 'gpt-4o-mini' },
            secretEnv('LLM_BINDING_API_KEY', 'openaiApiKey'),
            { name: 'EMBEDDING_BINDING', value: 'openai' },
            { name: 'EMBEDDING_MODEL', value: 'text-embedding-3-small' },
            // Must stay identical across every instance: the vector column
            // is sized on first init and all instances share one table.
            { name: 'EMBEDDING_DIM', value: '1536' },
            secretEnv('EMBEDDING_BINDING_API_KEY', 'openaiApiKey'),
            { name: 'POSTGRES_HOST', value: POSTGRES_HOST },
            { name: 'POSTGRES_PORT', value: '5432' },
            { name: 'POSTGRES_USER', value: 'rag' },
            { name: 'POSTGRES_PASSWORD', value: 'rag' },
            { name: 'POSTGRES_DATABASE', value: 'rag' },
            { name: 'LIGHTRAG_KV_STORAGE', value: 'PGKVStorage' },
            { name: 'LIGHTRAG_DOC_STATUS_STORAGE', value: 'PGDocStatusStorage' },
            { name: 'LIGHTRAG_VECTOR_STORAGE', value: 'PGVectorStorage' },
            { name: 'LIGHTRAG_GRAPH_STORAGE', value: 'PGGraphStorage' },
          ],
          volumeMounts: [
            { name: 'rag-storage', mountPath: '/app/data/rag_storage' },
            { name: 'inputs', mountPath: '/app/data/inputs' },
          ],
          readinessProbe: {
            tcpSocket: { port: PORT },
            initialDelaySeconds: 30,
            periodSeconds: 10,
          },
          resources: {
            requests: {
              cpu: `${AGENT_SLOT_CPU_MILLI}m`,
              memory: `${AGENT_SLOT_MEM_BYTES / (1024 * 1024)}Mi`,
            },
            limits: { cpu: '2', memory: '4Gi' },
          },
        },
      ],
      // All four storages live in Postgres — T001 verified both directories
      // stay at 0 bytes through ingest and survive a restart empty.
      volumes: [
        { name: 'rag-storage', emptyDir: {} },
        { name: 'inputs', emptyDir: {} },
      ],
    },
  };
}
