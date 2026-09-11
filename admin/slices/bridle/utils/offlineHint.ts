/**
 * When the chat may show the actionable "Agent is not connected to the bridle
 * hub" banner — the one that sends the operator to the pod env preview and the
 * bridle settings page.
 *
 * It is an accusation ("your BRIDLE_* configuration is broken"), so the bar is
 * the server's verdict, not the widget's sockets. The API watches a
 * Running+Ready pod that never registers on the hub and only then demotes the
 * agent to `unreachable`; the host passes that through as `agentState`.
 *
 * The old rule was "chat WS up and no agent_status yet", which is true for a
 * moment on *every* page load, reconnect and restart — the runtime registers
 * with the hub a beat after our own socket opens. That is why the banner
 * flashed, and why it contradicted the "Agent reconnecting…" line above it.
 */
export interface IOfflineHintInput {
  /** Host supplied troubleshooting links; absent means the host has no verdict. */
  hasHint: boolean
  /** Our own chat WS is connected to the hub. */
  chatConnected: boolean
  /** The hub says the agent runtime is registered right now. */
  agentConnected: boolean
  /** Host-reconciled agent state; `unreachable` is the server's verdict. */
  agentState: 'restarting' | 'failed' | 'stopped' | 'unreachable' | null
  /** How long the runtime has been continuously absent; null while it is present. */
  agentDownForMs: number | null
}

/**
 * Settle window before the banner may paint. The real gate is `unreachable`
 * above; this only covers the moment right after mount, where a status snapshot
 * is already in hand but our own socket has not yet heard whether the runtime
 * is registered.
 */
export const OFFLINE_HINT_SETTLE_MS = 5_000

export function shouldShowOfflineHint(input: IOfflineHintInput): boolean {
  if (!input.hasHint) return false
  // The runtime is on the hub right now — whatever the last status snapshot
  // said, the banner would describe a problem that no longer exists.
  if (input.agentConnected) return false
  // Both sockets down is a network story, not a configuration one.
  if (!input.chatConnected) return false
  if (input.agentDownForMs === null) return false
  if (input.agentDownForMs < OFFLINE_HINT_SETTLE_MS) return false
  // 'restarting' / 'failed' / 'stopped' have their own messaging, and a null
  // state means nobody has confirmed the runtime is really off the hub.
  return input.agentState === 'unreachable'
}
