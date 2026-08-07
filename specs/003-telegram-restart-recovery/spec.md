# Feature Specification: Telegram Channel Auto-Recovery After Agent Restart

**Feature Branch**: `fix/telegram-restart-recovery`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "Починить рестарт ТГ бота после рестарта агента. Telegram канал отмечен connected: false после перезагрузки, но polling не запускается автоматически. Bridle (env-sourced) восстанавливается сам, а файловый Telegram — нет."

## Problem Context

An agent owner connects a Telegram bot to their agent by talking to the agent in chat. The bot works until the agent restarts (self-restart, crash recovery, or redeploy). After the restart the channel list still shows the Telegram configuration, but marked as not connected — the bot silently stops receiving messages until a human reconfigures it. Channels supplied through the platform's deploy pipeline (Bridle, and Telegram configured via the admin panel) recover on their own; only the configuration saved by the agent itself is lost on restart. Root-cause investigation notes with code references: [research.md](research.md).

## Clarifications

### Session 2026-08-07

- Q: Is the admin panel's Channels tab blind to a chat-configured Telegram bot even though the bot exists (the "second bug")? → A: Confirmed in code: the panel reads the legacy configuration store while the agent writes to the newer per-channel store, so a chat-configured bot is invisible in the panel. Worse, in a mixed history (configured via panel, later replaced via chat) the panel shows — and the next deploy injects — the stale panel-era configuration.
- Q: Which store becomes the single source of truth for channel configuration, read by the admin panel and the deploy pipeline? → A: The agent-maintained per-channel configuration store; platform surfaces read it with a read-only fallback to the legacy store for agents configured before this change (no destructive data migration).
- Q: Where must operators see live channel status and the reason a channel failed to connect? → A: On both surfaces — the agent chat channel list and the admin panel Channels tab.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bot survives agent restart (Priority: P1)

An agent owner configured a Telegram bot by chatting with the agent. The agent restarts for any reason (self-restart after reconfiguration, crash, platform redeploy). The Telegram bot resumes receiving and answering messages on its own — the owner never notices the restart.

**Why this priority**: This is the reported defect. A silently dead messaging channel means missed user messages and erodes trust in the platform; today recovery requires a manual reconfiguration by an admin.

**Independent Test**: Configure a Telegram bot through agent chat, restart the agent, send the bot a Telegram message — the agent must answer without any human intervention in between.

**Acceptance Scenarios**:

1. **Given** an agent with a Telegram bot configured via chat and actively responding, **When** the agent restarts, **Then** the bot responds to new Telegram messages after startup completes, with no manual reconnection.
2. **Given** an agent with a Telegram bot configured via chat, **When** the agent is redeployed by the platform (new instance, clean local state), **Then** the persisted channel configuration is restored and the bot resumes responding.
3. **Given** an agent whose Telegram channel was explicitly removed before the restart, **When** the agent restarts, **Then** the Telegram channel stays removed and no polling starts.

---

### User Story 2 - Channel status tells the truth (Priority: P2)

An operator checks the agent's channel list (in chat or in the admin panel) after a restart. The status they see matches reality: "connected" only when the bot is actually listening, and a clear disconnected state with a discoverable reason when it is not.

**Why this priority**: The current failure is invisible until an end user complains. Truthful status turns a silent outage into a diagnosable one, and is the safety net for any future recovery gap.

**Independent Test**: Compare the reported channel status against actual bot behavior (does it answer a Telegram message?) right after a restart — both healthy and broken-token cases.

**Acceptance Scenarios**:

1. **Given** a restarted agent whose Telegram channel reconnected successfully, **When** the operator views the channel list, **Then** the channel shows as connected.
2. **Given** a restarted agent whose Telegram token became invalid (revoked/rotated), **When** the operator views the channel list in chat or the admin panel Channels tab, **Then** the channel shows as not connected with the failure reason, while the agent itself keeps running and other channels stay up.

---

### User Story 3 - One configuration, every surface (Priority: P3)

A Telegram bot configured by chatting with the agent is also visible in the platform admin panel, and stays configured across platform-driven redeploys — the same single configuration drives every surface (agent chat view, admin panel, deploy pipeline).

**Why this priority**: Today the configuration written by the agent and the configuration the platform reads have drifted apart, so each surface shows a different truth. Fixing recovery without converging the two leaves the admin panel blind to chat-configured bots and future redeploys fragile.

**Independent Test**: Configure a bot via agent chat, then open the platform admin panel channel view — the bot must be listed; redeploy from the panel — the bot must still work.

**Acceptance Scenarios**:

1. **Given** a Telegram bot configured via agent chat, **When** an admin opens the agent's channels in the admin panel, **Then** the bot configuration is listed there.
2. **Given** a Telegram bot configured via the admin panel, **When** the agent later updates it via chat, **Then** both surfaces show the updated configuration and the bot keeps working after the next restart.

---

### Edge Cases

- Persistent storage is unreachable at startup: the agent starts with local state and reports channel status accordingly; recovery happens without operator action once storage is reachable (at latest on the next restart).
- The stored token is invalid or revoked at restart: the agent still starts, other channels connect, the Telegram channel reports not connected with a reason; no crash loop.
- Conflicting configurations exist (deploy-pipeline-supplied and agent-saved) with different tokens: the agent-saved configuration wins, matching current precedence rules.
- A bot was configured via the admin panel and its token later replaced via agent chat: no surface may display, and no deploy may inject, the stale earlier configuration — the agent-saved configuration wins everywhere.
- Restart happens seconds after the bot was configured (configuration may not have finished persisting): the most recently saved configuration must not be lost.
- Two agent instances briefly overlap during redeploy: message polling must not end up permanently broken once the old instance is gone.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After any restart (self-restart, crash recovery, redeploy), the agent MUST automatically restore and start every messaging channel that was configured before the restart, regardless of whether it was configured via agent chat or via the admin panel.
- **FR-002**: A restored Telegram channel MUST resume receiving messages without any human action — no manual reconnect, no waiting for a periodic self-check.
- **FR-003**: The channel status shown to operators MUST reflect the channel's actual live state on both surfaces — the agent chat channel list and the admin panel Channels tab; a channel MUST NOT be reported as configured-but-dead without a discoverable reason.
- **FR-004**: The agent-maintained per-channel configuration store is the single source of truth: the admin panel and the deploy pipeline MUST read from it, with a read-only fallback to configurations created before this change (no destructive data migration). A configuration created or updated via agent chat MUST be visible in the admin panel and honored by subsequent deploys; a stale pre-existing configuration MUST NOT override a newer agent-saved one on any surface.
- **FR-005**: If a channel cannot be reconnected at startup (e.g., invalid token, provider unreachable), the agent MUST still start, other channels MUST connect, and the failed channel MUST be reported as not connected with the failure reason visible in both the agent chat channel list and the admin panel Channels tab.
- **FR-006**: A channel explicitly removed before a restart MUST remain removed after the restart.

### Key Entities

- **Channel configuration**: The persisted description of a messaging channel (type, credentials, display attributes). Created either by the agent itself (from chat) or by an admin (from the panel); must survive restarts and be readable by every surface.
- **Channel status**: The live view of a configured channel — connected or not, and why not. Derived from actual runtime state, never from the mere existence of a configuration.
- **Agent restart**: Any event that replaces the running agent process — self-restart, crash recovery, or platform redeploy — including ones that start from a clean local filesystem.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of restarts of an agent with a previously working chat-configured Telegram bot, the bot answers a Telegram message within 2 minutes of the agent reporting ready — with zero human actions in between.
- **SC-002**: Channel status shown to operators matches actual channel behavior (answers / does not answer) in 100% of checks performed one minute after startup.
- **SC-003**: Manual "reconnect the Telegram bot" interventions after restarts drop to zero.
- **SC-004**: A bot configured via agent chat appears in the admin panel channel view in 100% of cases, without any extra sync step.

## Assumptions

- The bot token remains valid across the restart in the primary scenario; invalid-token handling is covered as a failure-reporting path (FR-005), not silent retry-forever.
- The existing persistence layer (agent state synced to durable storage) remains the mechanism by which configuration survives redeploys; this feature fixes when that state is consulted, not how it is stored.
- Existing precedence — agent-saved configuration overrides deploy-pipeline-supplied configuration per channel type — is intentional and must be preserved.
- The scope spans two codebases: the agent runtime (restores and starts channels) and the platform (admin panel visibility and deploy-time configuration reads). Both are owned by the same team and can ship together.
- A periodic self-check (heartbeat) reconnect was considered as a minimal workaround; the requirements above target recovery at startup instead, so a heartbeat check is at most an optional extra safety net, not the fix.
- Bridle (the platform's own control channel) already recovers by design and is out of scope except as the reference behavior.
