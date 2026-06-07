import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import {
  IBridleGateway,
  ISyncAgentResult,
  IBridleAgentEvent,
} from '../domain/bridle.gateway';
import type {
  IBridleHealthData,
  IBridleAgentHealthData,
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
  agentId: string;
}

const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

/**
 * Hub implementation — manages per-agent connections and per-agent browser
 * client connections. Routes messages between them scoped by agentId.
 */
@Injectable()
export class BridleGateway extends IBridleGateway {
  private readonly logger = new Logger(BridleGateway.name);

  /** Agent connections: agentId → send function */
  private agents = new Map<string, (data: unknown) => void>();

  /** Browser clients: clientId → { agentId, send } */
  private clients = new Map<string, IBridleClientData>();

  /** Pending sync requests awaiting agent ack: requestId → pending */
  private pendingSyncs = new Map<string, IPendingSync>();

  /** Connect/disconnect events for AgentStatusService to reconcile DB status. */
  private readonly agentEvents = new Subject<IBridleAgentEvent>();

  registerAgent(agentId: string, send: (data: unknown) => void): void {
    this.agents.set(agentId, send);
    this.logger.log(
      `Agent registered: agentId=${agentId} (total agents: ${this.agents.size})`,
    );
    this.broadcastAgentStatus(agentId, true);
    this.agentEvents.next({ type: 'connected', agentId });
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.logger.warn(
      `Agent unregistered: agentId=${agentId} (total agents: ${this.agents.size})`,
    );
    // Cancel any pending sync requests for this agent — agent dropped before acking
    for (const [requestId, pending] of this.pendingSyncs) {
      if (pending.agentId !== agentId) continue;
      clearTimeout(pending.timer);
      this.pendingSyncs.delete(requestId);
      pending.reject(new Error('Agent disconnected before sync completed'));
    }
    this.broadcastAgentStatus(agentId, false);
    this.agentEvents.next({ type: 'disconnected', agentId });
  }

  agentEvents$(): Observable<IBridleAgentEvent> {
    return this.agentEvents.asObservable();
  }

  /**
   * Push current agent connection state to every browser client scoped to
   * this agentId. Used so the chat header can show green (both chat and
   * agent connected) vs orange (one side down) without polling.
   */
  private broadcastAgentStatus(agentId: string, connected: boolean): void {
    for (const client of this.clients.values()) {
      if (client.agentId !== agentId) continue;
      client.send({ type: 'agent_status', agentId, connected });
    }
  }

  isAgentConnected(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  registerClient(
    clientId: string,
    agentId: string,
    send: (data: unknown) => void,
    isAdmin: boolean,
    prompt?: string,
  ): void {
    this.clients.set(clientId, {
      agentId,
      send,
      isAdmin,
      ...(prompt ? { prompt } : {}),
    });
    this.logger.log(
      `Browser client registered: ${clientId} agentId=${agentId} admin=${isAdmin} (total: ${this.clients.size})`,
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
    agentId: string,
    text: string,
    parts: BridlePart[],
  ): void {
    const agentSend = this.agents.get(agentId);
    if (!agentSend) {
      this.logger.warn(
        `Cannot send to agent — not connected (agentId=${agentId})`,
      );
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

    const client = this.clients.get(clientId);
    agentSend({
      type: 'message',
      clientId,
      text,
      parts,
      ...(client?.prompt ? { prompt: client.prompt } : {}),
      messageId: randomUUID(),
    });
  }

  sendToClient(clientId: string, data: unknown): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.send(data);
    }
  }

  handleAgentEvent(agentId: string, data: IBridleOutgoingEvent): void {
    const clientId = data.clientId;
    if (!clientId) return;

    const client = this.clients.get(clientId);
    if (client && client.agentId === agentId) {
      client.send(data);
    }
  }

  setDebug(agentId: string, enabled: boolean): void {
    const agentSend = this.agents.get(agentId);
    if (!agentSend) {
      this.logger.debug(
        `setDebug skipped: agent not connected for agentId=${agentId}`,
      );
      return;
    }
    agentSend({ type: 'debug_set', enabled });
    this.logger.log(`Pushed debug_set=${enabled} to agent agentId=${agentId}`);
  }

  handleDebugEvent(agentId: string, data: IBridleDebugEvent): void {
    // Admin-only fan-out. We ignore data.clientId on purpose: the runtime
    // only knows the immediate sender, but multiple admins may be observing
    // the same agent and they all want to see prompt traces.
    let delivered = 0;
    for (const client of this.clients.values()) {
      if (client.agentId !== agentId) continue;
      if (!client.isAdmin) continue;
      client.send(data);
      delivered++;
    }
    if (delivered === 0) {
      this.logger.debug(
        `Debug event dropped: no admin clients for agentId=${agentId}`,
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

  agentHealth(agentId: string): IBridleAgentHealthData {
    let clientCount = 0;
    for (const client of this.clients.values()) {
      if (client.agentId === agentId) clientCount++;
    }
    return {
      ok: true,
      agentConnected: this.agents.has(agentId),
      browserClients: clientCount,
      agentId,
    };
  }

  syncAgent(
    agentId: string,
    timeoutMs: number = DEFAULT_SYNC_TIMEOUT_MS,
  ): Promise<ISyncAgentResult> {
    const agentSend = this.agents.get(agentId);
    if (!agentSend) {
      return Promise.resolve({ agentOnline: false, pushed: 0 });
    }

    const requestId = randomUUID();
    return new Promise<ISyncAgentResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSyncs.delete(requestId);
        reject(
          new Error(`Sync timed out after ${timeoutMs}ms (agentId=${agentId})`),
        );
      }, timeoutMs);

      this.pendingSyncs.set(requestId, { resolve, reject, timer, agentId });
      agentSend({ type: 'sync', requestId });
    });
  }

  handleSyncResponse(agentId: string, data: IBridleSyncResponse): void {
    const pending = this.pendingSyncs.get(data.requestId);
    if (!pending) {
      this.logger.warn(
        `Got sync_done for unknown requestId=${data.requestId} agentId=${agentId}`,
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

  listAgents(): Array<{ agentId: string; clients: number }> {
    const result: Array<{ agentId: string; clients: number }> = [];
    for (const agentId of this.agents.keys()) {
      let clients = 0;
      for (const c of this.clients.values()) {
        if (c.agentId === agentId) clients++;
      }
      result.push({ agentId, clients });
    }
    return result;
  }
}
