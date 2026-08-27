import {
  buildInstanceWorkflow,
  instancePodName,
  instanceServiceName,
  LIGHTRAG_IMAGE,
  IInstanceManifestInput,
} from './instance.manifest';

const input: IInstanceManifestInput = {
  knowledgeId: 'knowledge-11111111-2222-3333-4444-555555555555',
  knowledgeName: 'Test base',
  workspace: 'knowledge_knowledge11111111222233334444555555555555',
};

interface WorkflowTemplate {
  name: string;
  resource?: { action: string; manifest: string };
  steps?: unknown;
}

function workflowOf(i: IInstanceManifestInput) {
  return buildInstanceWorkflow(i) as {
    metadata: {
      generateName: string;
      namespace: string;
      labels: Record<string, string>;
    };
    spec: {
      serviceAccountName: string;
      templates: WorkflowTemplate[];
    };
  };
}

function resourceManifest(name: string): Record<string, any> {
  const wf = workflowOf(input);
  const template = wf.spec.templates.find((t) => t.name === name);
  if (!template?.resource) throw new Error(`template ${name} missing`);
  return JSON.parse(template.resource.manifest) as Record<string, any>;
}

describe('instance manifest', () => {
  test('image is pinned to a digest, never latest', () => {
    expect(LIGHTRAG_IMAGE).toContain('@sha256:');
    expect(LIGHTRAG_IMAGE).not.toContain(':latest');
  });

  test('workflow runs in agents with the workflow service account', () => {
    const wf = workflowOf(input);
    expect(wf.metadata.namespace).toBe('agents');
    expect(wf.spec.serviceAccountName).toBe('workflow');
    expect(wf.metadata.labels['ranch/knowledge-id']).toBe(input.knowledgeId);
  });

  test('pod carries the identity labels and the pinned image', () => {
    const pod = resourceManifest('instance-pod');
    expect(pod.metadata.name).toBe(instancePodName(input.knowledgeId));
    expect(pod.metadata.namespace).toBe('agents');
    expect(pod.metadata.labels['ranch/knowledge-id']).toBe(input.knowledgeId);
    expect(pod.metadata.labels['ranch/component']).toBe('retrieval');
    expect(pod.spec.containers[0].image).toBe(LIGHTRAG_IMAGE);
  });

  test('pod is sized as one agent slot with the shared instance limits', () => {
    const pod = resourceManifest('instance-pod');
    const resources = pod.spec.containers[0].resources;
    expect(resources.requests).toEqual({ cpu: '100m', memory: '512Mi' });
    expect(resources.limits).toEqual({ cpu: '2', memory: '4Gi' });
  });

  test('working directories are emptyDir — content lives in Postgres', () => {
    const pod = resourceManifest('instance-pod');
    const volumes = pod.spec.volumes as {
      name: string;
      emptyDir?: object;
    }[];
    expect(volumes).toHaveLength(2);
    for (const v of volumes) expect(v.emptyDir).toBeDefined();
    const mounts = pod.spec.containers[0].volumeMounts as {
      mountPath: string;
    }[];
    const paths = mounts.map((m) => m.mountPath).sort();
    expect(paths).toEqual(['/app/data/inputs', '/app/data/rag_storage']);
  });

  test('WORKSPACE fixes the isolation namespace at construction', () => {
    const pod = resourceManifest('instance-pod');
    const env = pod.spec.containers[0].env as {
      name: string;
      value?: string;
    }[];
    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    expect(byName.WORKSPACE).toBe(input.workspace);
  });

  test('embedding dim and postgres wiring match the shared deployment', () => {
    const pod = resourceManifest('instance-pod');
    const env = pod.spec.containers[0].env as {
      name: string;
      value?: string;
    }[];
    const byName = Object.fromEntries(env.map((e) => [e.name, e.value]));
    // The vector column is sized on first init and all instances share one
    // table — a drifting dim would corrupt retrieval for every base.
    expect(byName.EMBEDDING_DIM).toBe('1536');
    // Cross-namespace: the pod runs in agents, postgres in platform.
    expect(byName.POSTGRES_HOST).toBe(
      'lightrag-postgres.platform.svc.cluster.local',
    );
    expect(byName.LIGHTRAG_KV_STORAGE).toBe('PGKVStorage');
    expect(byName.LIGHTRAG_DOC_STATUS_STORAGE).toBe('PGDocStatusStorage');
    expect(byName.LIGHTRAG_VECTOR_STORAGE).toBe('PGVectorStorage');
    expect(byName.LIGHTRAG_GRAPH_STORAGE).toBe('PGGraphStorage');
  });

  test('pod schedules on the agent pool like every ranch workload', () => {
    const pod = resourceManifest('instance-pod');
    expect(pod.spec.nodeSelector).toEqual({ 'node-role': 'agents' });
    expect(pod.spec.tolerations).toEqual([
      { key: 'workload', value: 'agent', effect: 'NoSchedule' },
    ]);
  });

  test('service selects the pod by knowledge id on 9621', () => {
    const svc = resourceManifest('instance-service');
    expect(svc.metadata.name).toBe(instanceServiceName(input.knowledgeId));
    expect(svc.metadata.namespace).toBe('agents');
    expect(svc.spec.selector).toEqual({
      'ranch/knowledge-id': input.knowledgeId,
    });
    expect(svc.spec.ports).toEqual([{ port: 9621, targetPort: 9621 }]);
  });

  test('service creation is an apply so re-provision stays idempotent', () => {
    const wf = workflowOf(input);
    const svc = wf.spec.templates.find((t) => t.name === 'instance-service');
    expect(svc?.resource?.action).toBe('apply');
  });

  test('names stay valid DNS-1035 labels', () => {
    expect(instanceServiceName(input.knowledgeId).length).toBeLessThanOrEqual(
      63,
    );
    expect(instanceServiceName(input.knowledgeId)).toMatch(
      /^[a-z][a-z0-9-]*[a-z0-9]$/,
    );
  });
});
