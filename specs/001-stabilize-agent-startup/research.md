# Phase 0 Research: Stabilize Agent Startup Status & Logs

**Date**: 2026-07-30 · **Spec**: [spec.md](./spec.md)

Three parallel codebase investigations (API lifecycle, admin UI, MCP integration) resolved every unknown. No `NEEDS CLARIFICATION` items remain. Repo state at research time: branch `fix/agent-deploy`, byte-identical to `main`.

## Established facts (root causes)

### RC-1 — Transient `failed` after stop → start (FR-011)

Two independent server-side writers produce it; the first matches the ~30 s symptom exactly.

- **Primary**: the periodic drift sweep (`api/src/slices/agent/agent/domain/agentStatus.service.ts:283-296`, every 30 s) marks any agent whose DB status is "live" (`pending`/`deploying`/`running`) but has no pod as `failed`. After a deploy is submitted, the two-step Argo workflow (`cleanup-old` → `run-agent`, `api/src/slices/workflow/data/agent-workflow.manifest.ts:102-137`) leaves a legitimate pod-less window of ~10–30 s. The no-pod branch consults neither `DeployTracker` nor any grace period. Nothing corrects `failed` back to `deploying`; only pod-ready/bridle-connect flips it to `running` — the observed ~30 s.
- **Secondary (restart only)**: `syncStatus` inside `GET /agents/:id` (`agent.controller.ts:90-117`) reads the *just-cancelled old* workflow in the 1–3 s window between `cancelAgentWorkflow` and `setWorkflowId(new)` (`agentDeploy.service.ts:57→137`); phase `Failed` → writes `failed`. Inert for stop → start because stop nulls `workflowId`.
- **Aggravator (client)**: once a 5 s poll returns `failed`, the admin clears its restart-in-flight flag and stops polling (`admin/.../useAgentLifecycle.ts:261-267`, `failed ∉ POLL_STATUSES`) — the badge sticks on `failed` until something else refetches.
- **Related dead-end**: MCP tool `restart_agent` (`api/src/slices/rancher/rancher.tool.ts:96-110`) writes `deploying` without deploying anything — such an agent is *guaranteed* to be drift-marked `failed` 30 s later.

### RC-2 — First start indistinguishable from restart (FR-003)

The `Agent` model (`agent.prisma:8-31`) has no deploy-history field of any kind (verified: no `deployedAt`/`firstDeploy`/counter anywhere in schema or migrations). Both flows funnel into the same `deploy()` writing the same `deploying`. The admin has no differing code path either — the overlay always says "Cancelling old workflow and submitting a fresh one." even on a first deploy (`useAgentLifecycle.ts:197`).

### RC-3 — Raw Kubernetes 400 in the log panel (FR-006)

`log.controller.ts` already has a friendly `[container containercreating]` branch (line 115), but it never fires: `extractWaitingReason` (133–145) reads `err.body?.message` as an object property, while `@kubernetes/client-node` 1.4.0 throws `ApiException` whose `body` is a **raw JSON string** (`getBodyAsAny()` returns `body.text()` for this endpoint). Control falls through to `extractKubeError` → returns `e.message` (the multi-line `HTTP-Code: 400 …` dump) → embedded as `[log fetch failed: …]` (line 119) → rendered near-verbatim by the admin (`useAgentLogs.ts:39-41`). The 404 branch works only because it checks `e.code`, not the body. Same string-body assumption exists in `pod.gateway.ts:325-335` (log-noise only).

### RC-4 — MCP "CleanSlice connect failed … 404" on launch (FR-012)

- The agent runtime (separate repo, `ghcr.io/cleanslice/runtime`) connects to exactly the URL it is given — `new StreamableHTTPClientTransport(new URL(cfg.url))`, no path appended. The server list is fully baked at deploy time into the `MCP_SERVERS_B64` env var by the ranch API (`argo-workflow.gateway.ts:89-126`), which force-attaches the built-in CleanSlice server from the DB and passes its `url` verbatim.
- The DB row is seeded with `https://mcp.cleanslice.org/` (`mcpServer.seeder.ts:61`), but the real Streamable HTTP endpoint is `https://mcp.cleanslice.org/mcp` — verified live: `POST /` → 404 `Cannot POST /` (byte-for-byte the logged error), `POST /mcp` with an MCP `initialize` → 200.
- The seeder is **create-only** (`if (!existingCleanslice)`), the URL is not editable via API for built-ins, and DELETE is forbidden — so existing deployments keep the broken URL even after the default is fixed. Agents pick up a healed URL only on their next deploy (env is baked).
- The runtime logs the failure at **warn** and continues (0 tools, no retry until next pod start). The red "ERROR" styling comes from the admin classifier `agentLogs.ts:32-48`, whose `ERROR_TOKEN_RE` matches the substring `"error":"Not Found"` *inside the JSON body* of the message.
- **Conclusion: no runtime-repo changes required.** The fix is entirely platform-side.

## Decisions

### D1 — Deploy grace window, persisted (fixes RC-1 primary)

- **Decision**: Add `lastDeployStartedAt` (DB column, set by `deploy()` together with the `deploying` write). The drift sweep's no-pod branch skips agents whose `lastDeployStartedAt` is within **5 minutes** (the spec's safety timeout). When the window expires with no pod, it marks `failed` with `statusReason` = startup timeout. Explicit failure signals (`FAIL_WAITING_REASONS`, workflow-submit throw, pod phase `Failed`) keep firing immediately — the grace window applies only to the *absence-of-pod* heuristic, so real failures are not delayed (FR-009).
- **Rationale**: Persisting the timestamp makes the grace window survive API restarts (the in-memory `DeployTracker` alone would not) and gives the 5-minute definitive-failure timeout (clarification #2) a single source of truth. 5 min ≫ the legitimate 10–30 s pod-less window, and matches the spec exactly.
- **Alternatives considered**: (a) extend in-memory `DeployTracker` to cover the no-pod branch — rejected: lost on API restart, exactly when drift sweeps fire in bulk; (b) count consecutive pod-less sweeps before failing — rejected: implicit timing, harder to reason about and test than an explicit timestamp.

### D2 — Workflow-sync guard (fixes RC-1 secondary)

- **Decision**: Two cheap complementary fixes: (1) `restartAgent()` clears `workflowId` (null) *before* cancelling the old workflow, so a concurrent `GET /agents/:id` cannot resolve the doomed workflow; (2) `syncStatus` additionally refuses to write `failed` while the agent is inside the D1 grace window (defence in depth; also covers future callers).
- **Rationale**: Eliminates the race at its source rather than masking it; the guard reuses the same grace predicate as D1 — one concept, two writers.
- **Alternatives considered**: skip `syncStatus` entirely during `deploying` — rejected: it would also skip legitimate new-workflow failure detection later in a long deploy.

### D3 — Launch context + first-run marker (fixes RC-2)

- **Decision**: Add `firstDeployedAt` (set once, on first successful workflow submit) and `lastLaunchContext` (`'initial' | 'restart'`, written by `deploy()`: `initial` when `firstDeployedAt` is still null at call time, else `restart`). Expose `launchContext`, `statusReason`, and `firstDeployedAt` on agent responses; admin maps them and switches overlay/log-placeholder copy ("Setting up the agent for the first time…" vs "Restarting agent…"). Status vocabulary unchanged, per clarification #1 (option B). Config-change redeploys go through restart flows and correctly read as `restart` — the spec groups restart/update together.
- **Rationale**: Server-derived, survives reload (FR-005), no status-enum breakage, two nullable columns + DTO fields — minimal surface. `workflowId` was verified unusable as a proxy (cleared on stop; Argo workflow GC'd after 1 h).
- **Alternatives considered**: (a) new statuses `starting`/`restarting` — rejected by clarification #1; (b) client-side inference from the action the user clicked — rejected: dies on reload, violates FR-005.

### D4 — Parse string error bodies in k8s error handling (fixes RC-3)

- **Decision**: In `log.controller.ts`, normalize `ApiException.body`: if it is a string, `JSON.parse` it (try/catch) before reading `.message`; fall back to matching the waiting-reason regex against `e.message` too. With that, the existing `[container containercreating]` branch fires and the admin's existing spinner UI ("Container creating…") takes over — no new UI needed for this path. Apply the same normalization to `pod.gateway.ts`'s `extractKubeError`. `[log fetch failed: …]` remains only for genuinely unexpected errors, and its payload becomes the parsed one-line message, never the multi-line dump.
- **Rationale**: The friendly UX already exists on both sides of the contract; only the error-shape assumption is wrong. Smallest possible fix, no client change required for the marker path.
- **Alternatives considered**: upgrading `@kubernetes/client-node` — rejected for this feature: unrelated blast radius across every k8s call site; the string-body normalization is needed anyway for robustness.

### D5 — CleanSlice MCP URL: fix default + heal existing rows (fixes RC-4)

- **Decision**: (1) Change the seeded default to `https://mcp.cleanslice.org/mcp` (env override `CLEANSLICE_MCP_URL` still wins). (2) Make the seeder heal an *existing* built-in CleanSlice row on bootstrap: if its URL is the known-bad bare origin (or differs from the configured value for the built-in row), update it — idempotent, aligned with the "api owns this entry" comment in the seeder. Agents pick up the fix on their next deploy/restart, which this feature's validation covers.
- **Rationale**: A default-only fix would never repair the live deployment (create-only seeder, URL immutable via API for built-ins). Bootstrap healing fixes fresh *and* existing installs without a one-off migration script to operate.
- **Alternatives considered**: (a) one-off SQL data migration — rejected: the seeder is the declared owner of built-in rows and runs everywhere the API boots; (b) making the runtime append `/mcp` — rejected: wrong layer, runtime is a separate repo, and other MCP servers may legitimately live at other paths.

### D6 — Admin: poll-race guard, failed handling, log level classification

- **Decision**: (1) `useAgentLifecycle` skips its 5 s poll ticks while a lifecycle mutation (start/stop/restart request) is in flight, so a stale pre-restart status cannot overwrite the optimistic `deploying`. (2) The "clear restart-in-flight on `failed`" behaviour stays — after D1/D2 any `failed` during startup is definitive by construction. (3) `agentLogs.ts` classification prefers an explicit level token from the runtime log line over substring matches, so a warn-level line whose *body* contains `"error":"Not Found"` is no longer styled as ERROR (FR-008: non-fatal presented as non-fatal). Verify the runtime's exact line format against real pod logs during implementation before tightening the regex.
- **Rationale**: Server fixes remove the *source* of lies; these client fixes remove the remaining *amplifiers* (race, poison-pill styling). All are small, local edits to already-identified lines.
- **Alternatives considered**: request-sequence tokens on every poll — rejected as over-engineering once the mutation-in-flight guard exists; suppressing all error styling during startup — rejected: would hide real startup errors (violates FR-009).

## Cross-cutting notes

- **SDK regeneration**: admin consumes the API via generated `openapi-ts` SDK; after DTO changes run `bun run build:api` in `admin/` (requires the API's swagger). The agent gateway's raw-axios workaround for stop/start is outdated (SDK now has those calls) — may be cleaned up opportunistically but is not required by this feature.
- **Out of scope confirmed**: agent runtime repo (no changes needed), startup speed, Argo workflow topology, `@kubernetes/client-node` upgrade.
- **Release note**: prod deploys only happen on `v*` tag runs; the MCP heal activates on API boot, agents pick it up on next restart.
