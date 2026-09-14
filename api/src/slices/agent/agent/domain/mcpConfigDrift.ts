/**
 * Whether a running agent is still carrying the MCP configuration it booted
 * with.
 *
 * An agent receives its servers through MCP_SERVERS_B64, a pod env var
 * written when the pod is created. Change the servers afterwards and the
 * running pod never learns — it keeps the list it booted with until someone
 * restarts it, and nothing anywhere reports the gap. A server that is present
 * but unreachable at least logs `<name>: connect failed`; a server the pod was
 * never told about logs nothing at all, because there is nothing to fail
 * (CLEAN-86).
 *
 * The comparison is deliberately coarse: any change to a server's row counts,
 * including one that never reaches the pod (a description edit). Over-warning
 * is the safe direction here — the cost is a restart that was not strictly
 * needed, against an agent that silently runs without half its tools.
 */
export interface IMcpConfigDriftInput {
  /** The servers this agent should be running with, as they are now. */
  servers: Array<{ id: string; name: string; updatedAt: Date }>;
  /** When the current pod started; null when no pod is running. */
  podStartedAt: Date | null;
}

export interface IMcpConfigDrift {
  /** The pod predates a change to its MCP configuration. */
  restartRequired: boolean;
  /** Most recent change that the pod missed, ISO; null when in sync. */
  configChangedAt: string | null;
  /** Echoed back so a caller can show both sides of the comparison. */
  podStartedAt: string | null;
  /** Names of the servers that changed, for the operator-facing message. */
  changedServers: string[];
}

export function detectMcpConfigDrift(
  input: IMcpConfigDriftInput,
): IMcpConfigDrift {
  const { servers, podStartedAt } = input;

  // Nothing to restart, so nothing to ask for. An agent that is down is not
  // "stale", and marking it so would put a permanent warning on every
  // stopped agent.
  if (!podStartedAt) {
    return {
      restartRequired: false,
      configChangedAt: null,
      podStartedAt: null,
      changedServers: [],
    };
  }

  // Strictly after: the pod read its env at creation, so an edit stamped the
  // same instant is not evidence it missed anything. Using `>=` would leave
  // an agent marked stale forever.
  const changed = servers.filter(
    (s) => s.updatedAt.getTime() > podStartedAt.getTime(),
  );

  const latest = changed.reduce<Date | null>(
    (max, s) => (!max || s.updatedAt > max ? s.updatedAt : max),
    null,
  );

  return {
    restartRequired: changed.length > 0,
    configChangedAt: latest ? latest.toISOString() : null,
    podStartedAt: podStartedAt.toISOString(),
    changedServers: changed.map((s) => s.name),
  };
}
