import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { IBridleGateway } from '#/bridle/domain/bridle.gateway';
import { BridleSyncService } from '#/bridle/domain/bridleSync.service';
import { IAgentGateway } from '#/agent/agent/domain';
import {
  A2aErrorCodes,
  A2aRoles,
  A2aRpcError,
  A2aTaskStates,
  a2aTimestamp,
  hasNonTextPart,
  textOfParts,
  type IA2aGetTaskParams,
  type IA2aMessage,
  type IA2aSendMessageParams,
  type IA2aTask,
  type IA2aTaskStatus,
  type IRanchTaskMetadata,
} from './a2a.types';
import {
  DEFAULT_A2A_TIMEOUT_MS,
  DEFAULT_MAX_CHAIN,
  peerClientId,
} from './peer.types';
import { A2aTaskStore } from './a2aTask.store';

export interface IChainRejection {
  rejection: 'loop' | 'depth';
  message: string;
}

/**
 * The receiving half of A2A (CLEAN-74): an inbound task from a peer becomes
 * one synchronous conversation with this agent's runtime, and comes back as a
 * finished task.
 *
 * Every failure mode here is a *stated* task state rather than an exception,
 * because the caller is a language model that will otherwise fill the silence
 * itself. "peer not running" and "timed out" must arrive as facts it can
 * repeat to the person, never as an empty answer.
 */
@Injectable()
export class A2aServerService {
  private readonly logger = new Logger(A2aServerService.name);

  /**
   * Chains of requests currently being served, per agent. `ask_agent` reads
   * this to learn the chain it is a continuation of: a tool call carries no
   * protocol metadata of its own, so without it a second hop would start a
   * fresh chain and the depth rule would never bite.
   */
  private readonly inboundChains = new Map<string, string[]>();

  constructor(
    private readonly hub: IBridleGateway,
    private readonly sync: BridleSyncService,
    private readonly agents: IAgentGateway,
    private readonly tasks: A2aTaskStore,
    private readonly config: ConfigService,
  ) {}

  get timeoutMs(): number {
    const raw = Number(this.config.get('A2A_SYNC_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_A2A_TIMEOUT_MS;
  }

  get maxChain(): number {
    const raw = Number(this.config.get('A2A_MAX_CHAIN'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_CHAIN;
  }

  /** The chain of the request this agent is currently serving, if any. */
  currentChain(agentId: string): string[] {
    return this.inboundChains.get(agentId) ?? [];
  }

  async sendMessage(
    agentId: string,
    callerAgentId: string,
    params: IA2aSendMessageParams,
  ): Promise<IA2aTask> {
    const message = params?.message;
    if (!message || !Array.isArray(message.parts)) {
      throw new A2aRpcError(
        A2aErrorCodes.InvalidParams,
        'A message with parts is required',
      );
    }

    // Answering later over a channel this server does not have would be worse
    // than saying no: the caller would wait for a push that never comes.
    if (params.configuration?.returnImmediately === true) {
      throw new A2aRpcError(
        A2aErrorCodes.UnsupportedOperation,
        'This agent answers blocking requests only',
      );
    }

    if (hasNonTextPart(message.parts)) {
      throw new A2aRpcError(
        A2aErrorCodes.ContentTypeNotSupported,
        'This agent accepts text parts only',
      );
    }

    const contextId = message.contextId ?? `ctx-${crypto.randomUUID()}`;
    const inboundChain = readChain(message);
    const startedAt = Date.now();

    const rejection = await this.checkChain(inboundChain, agentId);
    if (rejection) {
      return this.finish(
        agentId,
        contextId,
        inboundChain,
        A2aTaskStates.Rejected,
        rejection.message,
        { rejection: rejection.rejection },
        startedAt,
      );
    }

    // Asked before sending: the hub answers an offline agent with a fabricated
    // "Agent is not connected" assistant message, which would reach the caller
    // as if the peer had said it. Checking first turns that into a failure the
    // caller must report, and saves it the full wait.
    if (!this.hub.isAgentConnected(agentId)) {
      return this.finish(
        agentId,
        contextId,
        inboundChain,
        A2aTaskStates.Failed,
        'peer not running',
        { failure: 'not_running' },
        startedAt,
      );
    }

    const chainForThisHop = [...inboundChain, agentId];
    this.inboundChains.set(agentId, chainForThisHop);
    try {
      const reply = await this.sync.sendAndAwait({
        agentId,
        // One conversation per (caller, context): follow-ups within a turn
        // keep their history, and nothing collides with a human's chat.
        clientId: peerClientId(callerAgentId, contextId),
        text: textOfParts(message.parts),
        // A peer cannot render a thinking timeline, so the runtime must not
        // stream one into a void.
        capabilities: [],
        timeoutMs: this.timeoutMs,
      });

      if (reply.timedOut) {
        return this.finish(
          agentId,
          contextId,
          inboundChain,
          A2aTaskStates.Failed,
          `timed out after ${Math.round(this.timeoutMs / 1000)}s`,
          { failure: 'timeout' },
          startedAt,
        );
      }

      return this.finish(
        agentId,
        contextId,
        inboundChain,
        A2aTaskStates.Completed,
        undefined,
        {},
        startedAt,
        reply.text,
      );
    } finally {
      this.inboundChains.delete(agentId);
    }
  }

  getTask(params: IA2aGetTaskParams): IA2aTask {
    const task = params?.id ? this.tasks.get(params.id) : null;
    if (!task) {
      throw new A2aRpcError(A2aErrorCodes.TaskNotFound, 'Task not found');
    }
    return task;
  }

  /** True when this server knows the task — decides -32002 vs -32001. */
  knowsTask(id: string): boolean {
    return this.tasks.get(id) !== null;
  }

  /**
   * Loop and depth rules (FR-012), applied on the RECEIVING side of every hop.
   * That placement is the point: the caller's own tool is itself a server on
   * the next hop, so one implementation covers both directions and an agent
   * cannot talk its way past the rule by being the one who asks.
   */
  private async checkChain(
    chain: string[],
    agentId: string,
  ): Promise<IChainRejection | null> {
    if (chain.includes(agentId)) {
      const agent = await this.agents.findById(agentId);
      const name = agent?.name ?? agentId;
      return {
        rejection: 'loop',
        message: `would loop: «${name}» is already in this chain`,
      };
    }
    if (chain.length >= this.maxChain) {
      return {
        rejection: 'depth',
        message: `too deep: the chain limit is ${this.maxChain} hops`,
      };
    }
    return null;
  }

  private finish(
    agentId: string,
    contextId: string,
    inboundChain: string[],
    state: IA2aTaskStatus['state'],
    causeText: string | undefined,
    ranch: Partial<IRanchTaskMetadata>,
    startedAt: number,
    replyText?: string,
  ): IA2aTask {
    const durationMs = Date.now() - startedAt;
    const task: IA2aTask = {
      id: crypto.randomUUID(),
      contextId,
      status: {
        state,
        timestamp: a2aTimestamp(),
        ...(causeText
          ? {
              message: {
                messageId: `m-${crypto.randomUUID()}`,
                role: A2aRoles.Agent,
                parts: [{ text: causeText }],
              } satisfies IA2aMessage,
            }
          : {}),
      },
      artifacts:
        state === A2aTaskStates.Completed
          ? [
              {
                artifactId: 'reply',
                name: 'reply',
                parts: [{ text: replyText ?? '' }],
              },
            ]
          : [],
      // The protocol allows replaying the conversation here; Ranch does not,
      // because a peer's transcript is its own business (spec: the caller gets
      // the reply, never the peer's context).
      history: [],
      metadata: {
        ranch: { chain: [...inboundChain, agentId], durationMs, ...ranch },
      },
    };

    if (state !== A2aTaskStates.Completed) {
      this.logger.log(
        `A2A task ${state} for agent=${agentId}: ${causeText ?? 'no cause'}`,
      );
    }

    this.tasks.put(task);
    return task;
  }
}

/** `metadata.ranch.chain`, defensively — a caller controls this field. */
function readChain(message: IA2aMessage): string[] {
  const ranch = message.metadata?.ranch as IRanchTaskMetadata | undefined;
  if (!ranch || !Array.isArray(ranch.chain)) return [];
  return ranch.chain.filter((id): id is string => typeof id === 'string');
}
