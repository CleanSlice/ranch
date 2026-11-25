import { toStatusFrame, toStatusFrameMessage } from './agentStatusFrame';
import { READER_HIDDEN_FIELDS } from './agentReaderView';
import type { IAgentStatus } from './agentStatus.service';
import type { IAgentData } from './agent.types';

const UPDATED = new Date('2026-11-17T10:00:00.000Z');

function status(): IAgentStatus {
  const agent: IAgentData = {
    id: 'a1',
    name: 'Private agent',
    templateId: 't1',
    llmCredentialId: 'llm-secret-binding',
    status: 'failed',
    statusReason: 'deploy workflow failed',
    workflowId: 'wf-1',
    firstDeployedAt: new Date(),
    lastDeployStartedAt: new Date(),
    lastPullAt: new Date(),
    lastSyncAt: new Date(),
    launchContext: 'restart',
    config: { operatorNote: 'operator-only' },
    resources: { cpu: '1', memory: '1Gi' },
    debugEnabled: true,
    isPublic: false,
    allowedOrigins: ['https://example.test'],
    knowledgeIds: ['k1'],
    isAdmin: true,
    pinned: true,
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: UPDATED,
  };
  return {
    agent,
    pod: {
      agentId: 'a1',
      podName: 'agent-a1',
      phase: 'Pending',
      ready: false,
      restartCount: 3,
      startedAt: null,
      terminating: false,
      lastTerminationReason: 'Error',
      containerWaitingReason: 'ImagePullBackOff',
      message: 'Back-off pulling image "registry.internal/agent:1"',
      observedAt: new Date().toISOString(),
    },
    bridleConnected: true,
  };
}

describe('toStatusFrame: what the public status stream says of an agent', () => {
  it('carries exactly these keys', () => {
    const frame = toStatusFrame(status());
    expect(Object.keys(frame).sort()).toEqual([
      'agent',
      'bridleConnected',
      'pod',
      'tools',
    ]);
    expect(Object.keys(frame.agent).sort()).toEqual([
      'id',
      'status',
      'updatedAt',
    ]);
    expect(Object.keys(frame.pod ?? {}).sort()).toEqual([
      'containerWaitingReason',
      'phase',
      'ready',
      'restartCount',
    ]);
  });

  it('keeps the status facts', () => {
    expect(toStatusFrame(status())).toEqual({
      agent: { id: 'a1', status: 'failed', updatedAt: UPDATED },
      pod: {
        phase: 'Pending',
        ready: false,
        restartCount: 3,
        containerWaitingReason: 'ImagePullBackOff',
      },
      bridleConnected: true,
      tools: null,
    });
  });

  it('says nothing a reader is not given, nor a name, a creator or pod text', () => {
    const text = JSON.stringify(toStatusFrame(status()));
    for (const key of [
      ...READER_HIDDEN_FIELDS,
      'name',
      'createdById',
      'isAdmin',
      'podName',
      'message',
    ]) {
      expect(text).not.toContain(`"${key}"`);
    }
    expect(text).not.toContain('operator-only');
    expect(text).not.toContain('registry.internal');
    expect(text).not.toContain('Private agent');
  });

  it('says in one word how the tools stand, and never which server (CLEAN-245)', () => {
    expect(toStatusFrame({ ...status(), tools: 'connecting' }).tools).toBe(
      'connecting',
    );
    expect(toStatusFrame({ ...status(), tools: 'limited' }).tools).toBe(
      'limited',
    );
    expect(toStatusFrame(status()).tools).toBeNull();
    // Anything else a caller hands in is not passed on.
    const odd = { ...status(), tools: 'Documents' } as unknown as IAgentStatus;
    expect(toStatusFrame(odd).tools).toBeNull();
  });

  it('has no pod when there is none', () => {
    expect(toStatusFrame({ ...status(), pod: null }).pod).toBeNull();
  });
});

describe('toStatusFrameMessage', () => {
  it('projects every agent of a snapshot', () => {
    const message = toStatusFrameMessage({
      type: 'snapshot',
      payload: [status(), status()],
    });
    expect(message).toEqual({
      type: 'snapshot',
      payload: [toStatusFrame(status()), toStatusFrame(status())],
    });
  });

  it('projects the agent of an event and keeps its type', () => {
    const message = toStatusFrameMessage({
      type: 'event',
      payload: { eventType: 'deleted', status: status() },
    });
    expect(message).toEqual({
      type: 'event',
      payload: { eventType: 'deleted', status: toStatusFrame(status()) },
    });
  });
});
