import { Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';
import { z } from 'zod';
import { Tool, ToolTopics } from '#mcp';
import {
  callerIsOperator,
  CONFIRM_SENTENCE,
  confirmed,
  ok,
  requireOperator,
  type ToolResult,
} from '#/mcp/tooling';
import type { IConditionallyListedTool } from '#/mcp/interfaces/conditional-listing.interface';
import type { IAuthTokenPayload } from '#/user/auth/domain';
import { IAgentGateway } from '#/agent/agent/domain';
import type { IAgentData } from '#/agent/agent/domain';
import { ISecretGateway } from './domain';
import type { ISecretListData } from './domain';

type AuthedRequest = Request & { user?: IAuthTokenPayload };

/** What `SetSecretDto` / `DeleteSecretDto` allow for a key. */
const MAX_KEY_LENGTH = 256;

const keySchema = z
  .string()
  .min(1)
  .max(MAX_KEY_LENGTH)
  .describe('Secret key, e.g. instagram:password');

/** What `ReplaceSecretsDto` allows: a flat string→string map, {} to clear. */
const storeSchema = z
  .record(z.string().min(1).max(MAX_KEY_LENGTH), z.string())
  .describe(
    'The complete new store as {KEY: value}. Pass {} to remove every secret.',
  );

/**
 * An agent's secrets from the chat, the way the Secrets tab does it
 * (CLEAN-109). Every call goes through `ISecretGateway`, the same facade
 * `SecretController` uses, so the AWS-vs-file choice and the store format
 * are decided in one place.
 *
 * The one rule that is this file's own: a value goes IN through a tool and
 * never comes OUT. The console lists values because a person is looking; a
 * tool result lands in a model's context and from there in a transcript, so
 * listings carry names and timestamps only and a set acknowledges without
 * echoing (FR-004).
 *
 * Operator agents only: a plain agent holds these secrets and must not be
 * able to read, rewrite or erase its own credentials on a prompt's say-so.
 */
@Injectable()
export class SecretTool implements IConditionallyListedTool {
  private readonly logger = new Logger(SecretTool.name);

  constructor(
    private readonly agents: IAgentGateway,
    private readonly secrets: ISecretGateway,
  ) {}

  async isListedForRequest(httpRequest: Request): Promise<boolean> {
    return Promise.resolve(callerIsOperator(httpRequest));
  }

  @Tool({
    name: 'list_agent_secrets',
    topic: ToolTopics.AgentWorkspace,
    title: 'List secret names',
    template: 'Which secrets does the agent «name» have?',
    description:
      'The names of the secrets stored for an agent and when each was last ' +
      'changed — never the values; those are only ever written. Also says ' +
      'which store holds them (aws or file). Read this before setting or ' +
      'deleting a key to see what exists. Takes the agent id: list_agents ' +
      'turns a name into one.',
    parameters: z.object({
      agentId: z
        .string()
        .describe('Agent id, e.g. agent-abc123 (list_agents has them)'),
    }),
  })
  async listAgentSecrets(
    { agentId }: { agentId: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    return ok(await this.summary(agent));
  }

  @Tool({
    name: 'set_agent_secret',
    topic: ToolTopics.AgentWorkspace,
    title: 'Set a secret',
    template: 'Set the secret «KEY» of the agent «name» to «value»',
    description:
      'Create or overwrite one secret of an agent (upsert). The result ' +
      'acknowledges the key and lists the names now in the store; the value ' +
      'is never repeated back, so do not expect to read it afterwards. The ' +
      'store is written directly — no restart is triggered here. An agent ' +
      'that already loaded this key when it started sees the new value ' +
      'after restart_agent.',
    parameters: z.object({
      agentId: z.string().describe('Agent id (list_agents has them)'),
      key: keySchema,
      value: z.string().min(1).describe('The secret value to store'),
    }),
  })
  async setAgentSecret(
    { agentId, key, value }: { agentId: string; key: string; value: string },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    await this.secrets.set(agentId, key, value);
    // Log the key, never the value: the API log is not a secret store.
    this.logger.log(`Secret set through MCP: agent=${agentId} key=${key}`);
    const data = await this.secrets.list(agentId);
    return ok({
      ok: true,
      agentId,
      key,
      provider: data.provider,
      secrets: names(data),
      note: restartNote(agentId),
    });
  }

  @Tool({
    name: 'delete_agent_secret',
    topic: ToolTopics.AgentWorkspace,
    title: 'Delete a secret',
    template: 'Delete the secret «KEY» of the agent «name»',
    destructive: true,
    description:
      'Remove one secret from an agent. There is no other copy of the value, ' +
      'so it cannot be restored — only set again if the person still has it. ' +
      'A key that does not exist is a no-op. The result lists the names ' +
      'that remain. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z.string().describe('Agent id (list_agents has them)'),
      key: keySchema,
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async deleteAgentSecret(
    args: { agentId: string; key: string; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { agentId, key } = args;
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    const refusal = confirmed(
      args,
      `delete the secret «${key}» of the agent «${agent.name}» — its value cannot be recovered`,
    );
    if (refusal) return refusal;
    await this.secrets.delete(agentId, key);
    this.logger.log(`Secret deleted through MCP: agent=${agentId} key=${key}`);
    const data = await this.secrets.list(agentId);
    return ok({
      ok: true,
      agentId,
      key,
      provider: data.provider,
      secrets: names(data),
      note: restartNote(agentId),
    });
  }

  @Tool({
    name: 'replace_agent_secrets',
    topic: ToolTopics.AgentWorkspace,
    title: 'Replace all secrets',
    template: 'Replace all secrets of the agent «name» with: «KEY=value, …»',
    destructive: true,
    description:
      "Replace an agent's whole secret store at once: every key not in the " +
      'new map is removed, and removed values cannot be recovered. Pass {} ' +
      'to clear the store. To change one key without touching the others use ' +
      'set_agent_secret instead. The result lists the key names now stored, ' +
      'never the values. ' +
      CONFIRM_SENTENCE,
    parameters: z.object({
      agentId: z.string().describe('Agent id (list_agents has them)'),
      store: storeSchema,
      confirm: z
        .boolean()
        .describe('Set true only after the person confirmed in the chat.'),
    }),
  })
  async replaceAgentSecrets(
    args: { agentId: string; store: Record<string, string>; confirm?: boolean },
    _context: unknown,
    httpRequest: AuthedRequest,
  ): Promise<ToolResult> {
    requireOperator(httpRequest);
    const { agentId, store } = args;
    const agent = await this.agents.findById(agentId);
    if (!agent) return notFound(agentId);
    const keys = Object.keys(store);
    const refusal = confirmed(
      args,
      keys.length === 0
        ? `remove every secret of the agent «${agent.name}»`
        : `replace every secret of the agent «${agent.name}» with exactly ${keys.length} ` +
            `(${keys.join(', ')}) — any other key is removed for good`,
    );
    if (refusal) return refusal;
    await this.secrets.replaceAll(agentId, store);
    this.logger.log(
      `Secrets replaced through MCP: agent=${agentId} keys=${keys.length}`,
    );
    const data = await this.secrets.list(agentId);
    return ok({
      ok: true,
      agentId,
      provider: data.provider,
      secrets: names(data),
      note: restartNote(agentId),
    });
  }

  /** The listing shape: names and timestamps, the values left in the store. */
  private async summary(agent: IAgentData) {
    const data = await this.secrets.list(agent.id);
    return {
      agentId: agent.id,
      agentName: agent.name,
      provider: data.provider,
      secrets: data.secrets.map((s) => ({
        name: s.name,
        updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
      })),
    };
  }
}

function notFound(agentId: string): ToolResult {
  return ok({
    error: `Agent ${agentId} not found — call list_agents to find the id`,
  });
}

/** Key names only, sorted so two listings of the same store read the same. */
function names(data: ISecretListData): string[] {
  return data.secrets.map((s) => s.name).sort();
}

/**
 * The API writes the store and stops there; it is the runtime that reads
 * secrets, and one that read a key at startup keeps what it read. Say so
 * rather than let the model promise the person an instant effect.
 */
function restartNote(agentId: string): string {
  return (
    'Written to the store directly; no restart was triggered. If the running ' +
    'agent already loaded this key when it started, it sees the change after ' +
    `restart_agent with id=${agentId}.`
  );
}
