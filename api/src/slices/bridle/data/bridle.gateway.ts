import { Injectable, Logger } from '@nestjs/common';
import { IBridleGateway, ISyncAgentResult } from '../domain/bridle.gateway';
import type {
  IBridleHealthData,
  IBridleBotHealthData,
  IBridleOutgoingEvent,
  IBridleSyncResponse,
  IBridleDebugEvent,
  IBridleClientData,
  BridlePart,
} from '../domain/bridle.types';
import { randomUUID } from 'crypto';

interface IPendingSync {
  resolve: (value: ISyncAgentResult) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
  botId: string;
}

const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

/**
 * Hub implementation — manages per-bot agent connections and per-bot browser
 * client connections. Routes messages between them scoped by botId.
 */
@Injectable()
export class BridleGateway extends IBridleGateway {
  private readonly logger = new Logger(BridleGateway.name);

  /** Agent connections: botId → send function */
  private agents = new Map<string, (data: unknown) => void>();

  /** Browser clients: clientId → { botId, send } */
  private clients = new Map<string, IBridleClientData>();

  /** Pending sync requests awaiting agent ack: requestId → pending */
  private pendingSyncs = new Map<string, IPendingSync>();

  registerAgent(botId: string, send: (data: unknown) => void): void {
    this.agents.set(botId, send);
    this.logger.log(
      `Agent registered: botId=${botId} (total agents: ${this.agents.size})`,
    );
  }

  unregisterAgent(botId: string): void {
    this.agents.delete(botId);
    this.logger.warn(
      `Agent unregistered: botId=${botId} (total agents: ${this.agents.size})`,
    );
    // Cancel any pending sync requests for this bot — agent dropped before acking
    for (const [requestId, pending] of this.pendingSyncs) {
      if (pending.botId !== botId) continue;
      clearTimeout(pending.timer);
      this.pendingSyncs.delete(requestId);
      pending.reject(new Error('Agent disconnected before sync completed'));
    }
  }

  registerClient(
    clientId: string,
    botId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
  ): void {
    this.clients.set(clientId, { botId, send, isAdmin });
    this.logger.log(
      `Browser client registered: ${clientId} botId=${botId} admin=${isAdmin} (total: ${this.clients.size})`,
    );
  }

  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
    this.logger.log(
      `Browser client unregistered: ${clientId} (total: ${this.clients.size})`,
    );
  }

  sendToAgent(
    clientId: string,
    botId: string,
    text: string,
    parts: BridlePart[],
  ): void {
    const agentSend = this.agents.get(botId);
    if (!agentSend) {
      this.logger.warn(`Cannot send to agent — not connected (botId=${botId})`);
      this.sendToClient(clientId, {
        type: 'message',
        text: 'Agent is not connected. Please try again later.',
        parts: [
          {
            type: 'text',
            text: 'Agent is not connected. Please try again later.',
          },
        ],
        messageId: randomUUID(),
        ts: Date.now(),
      });
      return;
    }

    agentSend({
      type: 'message',
      clientId,
      text,
      parts,
      messageId: randomUUID(),
    });
  }

  sendToClient(clientId: string, data: unknown): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.send(data);
    }
  }

  handleAgentEvent(botId: string, data: IBridleOutgoingEvent): void {
    const clientId = data.clientId;
    if (!clientId) return;

    const client = this.clients.get(clientId);
    if (client && client.botId === botId) {
      client.send(data);
    }
  }

  setDebug(botId: string, enabled: boolean): void {
    const agentSend = this.agents.get(botId);
    if (!agentSend) {
      this.logger.debug(
        `setDebug skipped: agent not connected for botId=${botId}`,
      );
      return;
    }
    agentSend({ type: 'debug_set', enabled });
    this.logger.log(`Pushed debug_set=${enabled} to agent botId=${botId}`);
  }

  handleDebugEvent(botId: string, data: IBridleDebugEvent): void {
    // Admin-only fan-out. We ignore data.clientId on purpose: the runtime
    // only knows the immediate sender, but multiple admins may be observing
    // the same bot and they all want to see prompt traces.
    let delivered = 0;
    for (const client of this.clients.values()) {
      if (client.botId !== botId) continue;
      if (!client.isAdmin) continue;
      client.send(data);
      delivered++;
    }
    if (delivered === 0) {
      this.logger.debug(
        `Debug event dropped: no admin clients for botId=${botId}`,
      );
    }
  }

  health(): IBridleHealthData {
    return {
      ok: true,
      agentConnected: this.agents.size > 0,
      browserClients: this.clients.size,
    };
  }

  botHealth(botId: string): IBridleBotHealthData {
    let clientCount = 0;
    for (const client of this.clients.values()) {
      if (client.botId === botId) clientCount++;
    }
    return {
      ok: true,
      agentConnected: this.agents.has(botId),
      browserClients: clientCount,
      botId,
    };
  }

  syncAgent(
    botId: string,
    timeoutMs: number = DEFAULT_SYNC_TIMEOUT_MS,
  ): Promise<ISyncAgentResult> {
    const agentSend = this.agents.get(botId);
    if (!agentSend) {
      return Promise.resolve({ agentOnline: false, pushed: 0 });
    }

    const requestId = randomUUID();
    return new Promise<ISyncAgentResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSyncs.delete(requestId);
        reject(
          new Error(`Sync timed out after ${timeoutMs}ms (botId=${botId})`),
        );
      }, timeoutMs);

      this.pendingSyncs.set(requestId, { resolve, reject, timer, botId });
      agentSend({ type: 'sync', requestId });
    });
  }

  handleSyncResponse(botId: string, data: IBridleSyncResponse): void {
    const pending = this.pendingSyncs.get(data.requestId);
    if (!pending) {
      this.logger.warn(
        `Got sync_done for unknown requestId=${data.requestId} botId=${botId}`,
      );
      return;
    }
    clearTimeout(pending.timer);
    this.pendingSyncs.delete(data.requestId);
    if (data.error) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve({ agentOnline: true, pushed: data.pushed ?? 0 });
    }
  }

  listAgents(): Array<{ botId: string; clients: number }> {
    const result: Array<{ botId: string; clients: number }> = [];
    for (const botId of this.agents.keys()) {
      let clients = 0;
      for (const c of this.clients.values()) {
        if (c.botId === botId) clients++;
      }
      result.push({ botId, clients });
    }
    return result;
  }
}
