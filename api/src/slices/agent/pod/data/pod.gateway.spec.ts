// @kubernetes/client-node is ESM-only — stub its runtime exports so ts-jest
// (CJS) can load pod.gateway.ts; computeClusterCapacity never touches them.
jest.mock('@kubernetes/client-node', () => ({
  CoreV1Api: class {},
  KubeConfig: class {},
  Metrics: class {},
  Watch: class {},
}));

import type { V1Node, V1Pod } from '@kubernetes/client-node';
import { computeClusterCapacity } from './pod.gateway';

// Slot = 100m CPU / 512Mi — the fixed requests floor of every agent pod.

function agentNode(
  name: string,
  cpu: string,
  memory: string,
  overrides: Partial<V1Node['spec'] & { labels: Record<string, string> }> = {},
): V1Node {
  const { labels, ...spec } = overrides;
  return {
    metadata: { name, labels: labels ?? { 'node-role': 'agents' } },
    spec: {
      taints: [{ key: 'workload', value: 'agent', effect: 'NoSchedule' }],
      ...spec,
    },
    status: { allocatable: { cpu, memory } },
  } as V1Node;
}

function pod(
  nodeName: string | undefined,
  requests: { cpu?: string; memory?: string } | undefined,
  labels: Record<string, string> = {},
): V1Pod {
  return {
    metadata: { name: `pod-${Math.random().toString(36).slice(2)}`, labels },
    spec: {
      nodeName,
      containers: [{ name: 'main', resources: requests ? { requests } : {} }],
    },
  } as V1Pod;
}

const AGENT_LABELS = { app: 'ranch-agent' };

describe('computeClusterCapacity', () => {
  it('derives free slots from allocatable minus summed requests', () => {
    // 2 CPU / 4Gi node, one pod requesting 500m / 1Gi →
    // free 1500m / 3Gi → min(15 cpu-slots, 6 mem-slots) = 6.
    const nodes = [agentNode('n1', '2', '4Gi')];
    const pods = [pod('n1', { cpu: '500m', memory: '1Gi' })];

    const result = computeClusterCapacity(nodes, pods);

    expect(result.nodes).toEqual([
      {
        name: 'n1',
        freeCpuMilli: 1500,
        freeMemBytes: 3 * 1024 ** 3,
        freeSlots: 6,
      },
    ]);
    expect(result.freeAgentSlots).toBe(6);
    expect(result.slotCpuMilli).toBe(100);
    expect(result.slotMemBytes).toBe(512 * 1024 ** 2);
  });

  it('is cpu-bound when cpu is the scarcer resource', () => {
    // free 300m / 8Gi → min(3, 16) = 3.
    const nodes = [agentNode('n1', '1', '8Gi')];
    const pods = [pod('n1', { cpu: '700m', memory: '1Gi' })];

    expect(computeClusterCapacity(nodes, pods).freeAgentSlots).toBe(3);
  });

  it('sums slots across eligible nodes', () => {
    const nodes = [agentNode('n1', '1', '2Gi'), agentNode('n2', '1', '2Gi')];

    // Each node: 1000m/2Gi free → min(10, 4) = 4.
    expect(computeClusterCapacity(nodes, []).freeAgentSlots).toBe(8);
  });

  it('clamps oversubscribed nodes to zero instead of going negative', () => {
    const nodes = [agentNode('n1', '1', '1Gi')];
    const pods = [pod('n1', { cpu: '2', memory: '2Gi' })];

    const result = computeClusterCapacity(nodes, pods);
    expect(result.nodes[0].freeSlots).toBe(0);
    expect(result.freeAgentSlots).toBe(0);
  });

  it('ignores nodes without the node-role=agents label', () => {
    const nodes = [
      agentNode('system-node', '8', '16Gi', { labels: { 'node-role': 'system' } }),
      agentNode('unlabeled', '8', '16Gi', { labels: {} }),
    ];

    const result = computeClusterCapacity(nodes, []);
    expect(result.nodes).toEqual([]);
    expect(result.freeAgentSlots).toBe(0);
  });

  it('ignores cordoned nodes', () => {
    const nodes = [agentNode('n1', '2', '4Gi', { unschedulable: true })];

    expect(computeClusterCapacity(nodes, []).freeAgentSlots).toBe(0);
  });

  it('ignores nodes with taints the agent pod does not tolerate', () => {
    const nodes = [
      agentNode('not-ready', '2', '4Gi', {
        taints: [
          { key: 'workload', value: 'agent', effect: 'NoSchedule' },
          { key: 'node.kubernetes.io/not-ready', effect: 'NoExecute' },
        ],
      }),
    ];

    expect(computeClusterCapacity(nodes, []).freeAgentSlots).toBe(0);
  });

  it('accepts the tolerated workload=agent taint and PreferNoSchedule taints', () => {
    const nodes = [
      agentNode('n1', '1', '2Gi', {
        taints: [
          { key: 'workload', value: 'agent', effect: 'NoSchedule' },
          { key: 'soft-pressure', effect: 'PreferNoSchedule' },
        ],
      }),
    ];

    expect(computeClusterCapacity(nodes, []).freeAgentSlots).toBe(4);
  });

  it('counts requests of pods from any namespace and treats missing requests as zero', () => {
    const nodes = [agentNode('n1', '1', '2Gi')];
    const pods = [
      pod('n1', { cpu: '500m', memory: '1Gi' }),
      pod('n1', undefined), // best-effort pod: no requests → 0
    ];

    // free 500m / 1Gi → min(5, 2) = 2.
    expect(computeClusterCapacity(nodes, pods).freeAgentSlots).toBe(2);
  });

  it('uses the scheduler formula: max(sum of containers, max init container)', () => {
    const nodes = [agentNode('n1', '1', '2Gi')];
    const heavyInit: V1Pod = {
      metadata: { name: 'heavy-init' },
      spec: {
        nodeName: 'n1',
        initContainers: [
          { name: 'init', resources: { requests: { cpu: '800m', memory: '256Mi' } } },
        ],
        containers: [
          { name: 'main', resources: { requests: { cpu: '200m', memory: '1Gi' } } },
        ],
      },
    } as V1Pod;

    // Effective request: cpu max(200, 800) = 800m, mem max(1Gi, 256Mi) = 1Gi
    // → free 200m / 1Gi → min(2, 2) = 2.
    expect(computeClusterCapacity(nodes, [heavyInit]).freeAgentSlots).toBe(2);
  });

  it('skips unscheduled pods — they hold no node capacity yet', () => {
    const nodes = [agentNode('n1', '1', '2Gi')];
    const pods = [pod(undefined, { cpu: '900m', memory: '1Gi' }, AGENT_LABELS)];

    expect(computeClusterCapacity(nodes, pods).freeAgentSlots).toBe(4);
  });

  it('counts live agent pods as usedAgentSlots, wherever they run', () => {
    const nodes = [agentNode('n1', '4', '8Gi')];
    const pods = [
      pod('n1', { cpu: '100m', memory: '512Mi' }, AGENT_LABELS),
      pod('n1', { cpu: '100m', memory: '512Mi' }, AGENT_LABELS),
      pod('n1', { cpu: '500m', memory: '1Gi' }), // non-agent pod
      pod(undefined, { cpu: '100m', memory: '512Mi' }, AGENT_LABELS), // pending agent
    ];

    const result = computeClusterCapacity(nodes, pods);
    expect(result.usedAgentSlots).toBe(3);
    expect(result.totalAgentSlots).toBe(result.usedAgentSlots + result.freeAgentSlots);
  });

  it('stamps observedAt with an ISO timestamp', () => {
    const result = computeClusterCapacity([], []);
    expect(new Date(result.observedAt).toISOString()).toBe(result.observedAt);
  });
});
