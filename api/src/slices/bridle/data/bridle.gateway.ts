import { Injectable, Logger } from '@nestjs/common'
import { IBridleGateway } from '../domain/bridle.gateway'
import type { IBridleHealthData, IBridleBotHealthData, IBridleOutgoingEvent, IBridleClientData, BridlePart } from '../domain/bridle.types'
import { randomUUID } from 'crypto'

/**
 * Hub implementation — manages per-bot agent connections and per-bot browser
 * client connections. Routes messages between them scoped by botId.
 */
@Injectable()
export class BridleGateway extends IBridleGateway {
  private readonly logger = new Logger(BridleGateway.name)

  /** Agent connections: botId → send function */
  private agents = new Map<string, (data: unknown) => void>()

  /** Browser clients: clientId → { botId, send } */
  private clients = new Map<string, IBridleClientData>()

  registerAgent(botId: string, send: (data: unknown) => void): void {
    this.agents.set(botId, send)
    this.logger.log(`Agent registered: botId=${botId} (total agents: ${this.agents.size})`)
  }

  unregisterAgent(botId: string): void {
    this.agents.delete(botId)
    this.logger.warn(`Agent unregistered: botId=${botId} (total agents: ${this.agents.size})`)
  }

  registerClient(clientId: string, botId: string, send: (data: unknown) => void): void {
    this.clients.set(clientId, { botId, send })
    this.logger.log(`Browser client registered: ${clientId} botId=${botId} (total: ${this.clients.size})`)
  }

  unregisterClient(clientId: string): void {
    this.clients.delete(clientId)
    this.logger.log(`Browser client unregistered: ${clientId} (total: ${this.clients.size})`)
  }

  sendToAgent(clientId: string, botId: string, text: string, parts: BridlePart[]): void {
    const agentSend = this.agents.get(botId)
    if (!agentSend) {
      this.logger.warn(`Cannot send to agent — not connected (botId=${botId})`)
      this.sendToClient(clientId, {
        type: 'message',
        text: 'Agent is not connected. Please try again later.',
        parts: [{ type: 'text', text: 'Agent is not connected. Please try again later.' }],
        messageId: randomUUID(),
        ts: Date.now(),
      })
      return
    }

    agentSend({
      type: 'message',
      clientId,
      text,
      parts,
      messageId: randomUUID(),
    })
  }

  sendToClient(clientId: string, data: unknown): void {
    const client = this.clients.get(clientId)
    if (client) {
      client.send(data)
    }
  }

  handleAgentEvent(botId: string, data: IBridleOutgoingEvent): void {
    const clientId = data.clientId
    if (!clientId) return

    const client = this.clients.get(clientId)
    if (client && client.botId === botId) {
      client.send(data)
    }
  }

  health(): IBridleHealthData {
    return {
      ok: true,
      agentConnected: this.agents.size > 0,
      browserClients: this.clients.size,
    }
  }

  botHealth(botId: string): IBridleBotHealthData {
    let clientCount = 0
    for (const client of this.clients.values()) {
      if (client.botId === botId) clientCount++
    }
    return {
      ok: true,
      agentConnected: this.agents.has(botId),
      browserClients: clientCount,
      botId,
    }
  }

  listAgents(): Array<{ botId: string; clients: number }> {
    const result: Array<{ botId: string; clients: number }> = []
    for (const botId of this.agents.keys()) {
      let clients = 0
      for (const c of this.clients.values()) {
        if (c.botId === botId) clients++
      }
      result.push({ botId, clients })
    }
    return result
  }
}
