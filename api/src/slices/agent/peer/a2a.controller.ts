import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { RawResponse } from '#/setup/error/rawResponse.decorator';
import { AgentCardService } from './domain/agentCard.service';
import { A2aServerService } from './domain/a2a.server.service';
import {
  A2A_VERSION,
  A2aErrorCodes,
  A2aMethods,
  A2aRpcError,
  A2A_KNOWN_METHODS,
  type IA2aAgentCard,
  type IJsonRpcResponse,
  type JsonRpcId,
} from './domain/a2a.types';
import { A2aCardGuard, A2aPeerGuard } from './guards/a2a.guards';
import type { IA2aRequest } from './guards/a2a.guards';

/**
 * The public A2A surface of every Ranch agent (CLEAN-74).
 *
 * Excluded from the OpenAPI document on purpose: this is not Ranch's API, it
 * is the Agent2Agent protocol, and generating console SDK methods for it would
 * invite our own frontends to call it. The contract that matters lives in the
 * published spec and in `specs/013-a2a-agent-peers/contracts/a2a-api.md`.
 *
 * Both routes answer raw bodies — an agent card and JSON-RPC envelopes are
 * shapes other implementations parse, so the `{ success, data }` wrapper would
 * make this server unreadable to every standard client.
 */
@ApiExcludeController()
@Controller('a2a/agents')
export class A2aController {
  constructor(
    private readonly cards: AgentCardService,
    private readonly server: A2aServerService,
  ) {}

  /** Discovery. The path is the spec's, prefixed per agent because one host
   *  serves many agents and the domain root cannot name one of them. */
  @RawResponse()
  @UseGuards(A2aCardGuard)
  @Get(':agentId/.well-known/agent-card.json')
  async card(@Param('agentId') agentId: string): Promise<IA2aAgentCard> {
    return this.cards.build(agentId);
  }

  /**
   * Everything else. One POST, JSON-RPC inside — so protocol errors travel as
   * JSON-RPC error objects with a 200, which is what the spec's clients expect,
   * while credential failures stay real HTTP 401s from the guard.
   */
  @RawResponse()
  @UseGuards(A2aPeerGuard)
  @HttpCode(200)
  @Post(':agentId')
  async rpc(
    @Param('agentId') agentId: string,
    @Req() request: IA2aRequest,
    @Body() body: unknown,
    @Headers('a2a-version') version?: string,
  ): Promise<IJsonRpcResponse> {
    const envelope = (body ?? {}) as Record<string, unknown>;
    const id = (envelope.id ?? null) as JsonRpcId;

    try {
      // An absent header means 0.3 per spec, whose field names differ enough
      // that answering it with 1.0 shapes would be a silent mistranslation.
      if (version !== A2A_VERSION) {
        throw new A2aRpcError(
          A2aErrorCodes.VersionNotSupported,
          `This agent speaks A2A ${A2A_VERSION}; send the ${'A2A-Version'} header`,
        );
      }

      if (envelope.jsonrpc !== '2.0' || typeof envelope.method !== 'string') {
        throw new A2aRpcError(
          A2aErrorCodes.InvalidRequest,
          'Not a JSON-RPC 2.0 request',
        );
      }

      const result = await this.dispatch(
        envelope.method,
        envelope.params,
        agentId,
        request.peer?.callerAgentId ?? '',
      );
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return { jsonrpc: '2.0', id, error: toRpcError(err) };
    }
  }

  private async dispatch(
    method: string,
    params: unknown,
    agentId: string,
    callerAgentId: string,
  ): Promise<unknown> {
    switch (method) {
      case A2aMethods.SendMessage: {
        const task = await this.server.sendMessage(
          agentId,
          callerAgentId,
          params as never,
        );
        return { task };
      }
      case A2aMethods.GetTask: {
        return { task: this.server.getTask(params as never) };
      }
      case A2aMethods.CancelTask: {
        const id = (params as { id?: string } | undefined)?.id ?? '';
        // Telling a caller "cannot be cancelled" about a task that does not
        // exist would send it looking for a task it never had.
        throw this.server.knowsTask(id)
          ? new A2aRpcError(
              A2aErrorCodes.TaskNotCancelable,
              'This agent answers synchronously; a task is over by the time you hold it',
            )
          : new A2aRpcError(A2aErrorCodes.TaskNotFound, 'Task not found');
      }
      default:
        if (A2A_KNOWN_METHODS.includes(method)) {
          throw new A2aRpcError(
            A2aErrorCodes.UnsupportedOperation,
            `This agent does not support ${method}`,
          );
        }
        throw new A2aRpcError(
          A2aErrorCodes.MethodNotFound,
          `Unknown method: ${method}`,
        );
    }
  }
}

function toRpcError(err: unknown): { code: number; message: string } {
  if (err instanceof A2aRpcError) {
    return { code: err.code, message: err.message };
  }
  return {
    code: A2aErrorCodes.Internal,
    message: err instanceof Error ? err.message : 'Internal error',
  };
}
