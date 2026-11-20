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
import { HandoverService } from './handover';

/** The connection a request arrived through, as the peer guard resolved it. */
export interface IInboundPeer {
  /** Id of the connection the presented credential belongs to. */
  peerId: string;
  /** The agent that holds that connection: the one asking. */
  callerAgentId: string;
}

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
   * Chains of requests currently being served, per agent: the fallback for a
   * runtime that does not carry the hand-over token on its tool calls
   * (before 0.36). `ask_agent` then reads the chain it continues from here.
   *
   * One slot per agent, so two questions served at once overwrite each
   * other's chain; that is why the token carries the chain since CLEAN-236,
   * and a call that states its hand-over never looks here.
   */
  private readonly inboundChains = new Map<string, string[]>();

  constructor(
    private readonly hub: IBridleGateway,
    private readonly sync: BridleSyncService,
    private readonly agents: IAgentGateway,
    private readonly tasks: A2aTaskStore,
    private readonly config: ConfigService,
    private readonly handover: HandoverService,
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

  /**
   * `peer` is the connection the request arrived through. The question must
   * carry the hand-over token minted for exactly that connection and this
   * agent (CLEAN-236): every connection here is between two agents of this
   * Ranch, whose asking side is this API, so a request without one was not
   * made by `DelegationService` and is refused.
   */
  async sendMessage(
    agentId: string,
    peer: IInboundPeer,
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

    const pass = readPass(message);
    const handover = await this.handover.verify(pass, agentId);
    if (!handover || handover.connectionId !== peer.peerId) {
      throw new A2aRpcError(
        A2aErrorCodes.InvalidParams,
        'This agent takes questions handed over by its Ranch only',
      );
    }

    const contextId = message.contextId ?? `ctx-${crypto.randomUUID()}`;
    // From the token, which this API signed: the field beside it in the
    // message is the caller's to write.
    const inboundChain = handover.chain;
    const startedAt = Date.now();

    const rejection = await this.checkChain(inboundChain, agentId);
    if (rejection) {
      return this.finish(
        agentId,
        peer.peerId,
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
        peer.peerId,
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
        // One conversation per (connection, context): follow-ups within a
        // turn keep their history, and nothing collides with a human's chat.
        clientId: peerClientId(peer.peerId, contextId),
        text: textOfParts(message.parts),
        // What tells the runtime, and through it every tool call of the
        // turn, that a colleague is asking and not a visitor.
        handover: { token: pass as string },
        // A peer cannot render a thinking timeline, so the runtime must not
        // stream one into a void.
        capabilities: [],
        timeoutMs: this.timeoutMs,
        // Agent-to-agent traffic has its own chain limit and is never refused
        // by the request limits meant for people: refusing mid-task would
        // break the calling agent's answer (CLEAN-224).
        source: 'peer',
      });

      if (reply.timedOut) {
        return this.finish(
          agentId,
          peer.peerId,
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
        peer.peerId,
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

  /**
   * A task is answerable to the connection it was made through and to no
   * other (CLEAN-236): any valid pair credential used to read any task by
   * its id.
   */
  getTask(params: IA2aGetTaskParams, peer: IInboundPeer): IA2aTask {
    const task = params?.id ? this.tasks.get(params.id, peer.peerId) : null;
    if (!task) {
      throw new A2aRpcError(A2aErrorCodes.TaskNotFound, 'Task not found');
    }
    return task;
  }

  /** True when this server knows the task — decides -32002 vs -32001. */
  knowsTask(id: string, peer: IInboundPeer): boolean {
    return this.tasks.get(id, peer.peerId) !== null;
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
    connectionId: string,
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

    this.tasks.put(task, connectionId);
    return task;
  }
}

/** `metadata.ranch.pass`, defensively — a caller controls this field. */
function readPass(message: IA2aMessage): string | null {
  const ranch = message.metadata?.ranch as IRanchTaskMetadata | undefined;
  return typeof ranch?.pass === 'string' && ranch.pass ? ranch.pass : null;
}
