import type { IAgentData } from './agent.types';

/**
 * An agent as somebody who may NOT manage it reads it (CLEAN-232).
 *
 * `GET /agents`, `GET /agents/:id` and `GET /agents/status` are open to every
 * signed-in account, and `GET /agents/public` to everybody. They used to hand
 * all of them the whole row: the free-form `config`, which model credential
 * the agent is bound to, its knowledge bases, its workflow and deploy
 * history, the reason of its last failure, its debug switch. That is the
 * operator's view of an agent. A reader gets what the user console draws
 * (`app/slices/agent/data/agent.mapper.ts`): the name, the template, the
 * status, the resources, visibility, the pin and the dates.
 *
 * The fields stay on the object, emptied, so the response keeps one shape
 * (`AgentDto`) for every reader and a console never meets `undefined`.
 * `createdById` is not touched here: the controller takes it off for
 * everybody and resolves `createdBy` for the readers it is meant for.
 *
 * This is the only place that decides what a reader does not get. Whether a
 * caller may manage the agent is `AgentPermissionService.canManage`.
 */
export function toReaderView<T extends IAgentData>(agent: T): T {
  return {
    ...agent,
    llmCredentialId: null,
    statusReason: null,
    workflowId: null,
    firstDeployedAt: null,
    lastDeployStartedAt: null,
    launchContext: null,
    lastPullAt: null,
    lastSyncAt: null,
    config: {},
    debugEnabled: false,
    knowledgeIds: [],
  };
}

/**
 * An agent as a tool hands it back to a person who manages it only because
 * the assistant setting gave them that tool (CLEAN-254): the reader view,
 * and no creator id. They may restart or rename the agent; that does not
 * make its configuration, its credential or its deploy history theirs to
 * read.
 */
export function toGrantedView<T extends IAgentData>(
  agent: T,
): Omit<T, 'createdById'> {
  const view: Partial<T> = { ...toReaderView(agent) };
  delete view.createdById;
  return view as Omit<T, 'createdById'>;
}

/** The fields `toReaderView` empties. Pinned by agentReaderView.spec.ts. */
export const READER_HIDDEN_FIELDS = [
  'llmCredentialId',
  'statusReason',
  'workflowId',
  'firstDeployedAt',
  'lastDeployStartedAt',
  'launchContext',
  'lastPullAt',
  'lastSyncAt',
  'config',
  'debugEnabled',
  'knowledgeIds',
] as const;
