# Quickstart Validation: Stabilize Agent Startup Status & Logs

**Date**: 2026-07-30 · **Contracts**: [contracts/agent-api.md](./contracts/agent-api.md) · **Success criteria**: [spec.md](./spec.md) §Success Criteria

## Prerequisites

- Local stack: `bun install`, then `cd api && bun run dev` (starts docker deps via `predev`, runs migrations — the new migration must apply cleanly to an existing dev DB) and `cd admin && bun run dev` (regenerates the SDK from swagger via `predev`; verify `launchContext`/`statusReason`/`firstDeployedAt` appear in `admin/slices/setup/api/data/repositories/api/types.gen.ts`).
- Full lifecycle scenarios need a Kubernetes + Argo environment (`k8s/local/` k3d setup) with `infrastructure.workflow_provider = argo`; the mock provider does not reproduce the pod-less window.
- Checks: `cd api && bun run test` (Jest); pure-TS admin changes via `tsc` (repo has no vue-tsc).

## S1 — Stop → start shows no transient `failed` (P1; FR-001/002/010, SC-001)

1. Take a `running` agent. Stop it (`POST /agents/:id/stop` or the admin Stop button) → status becomes `stopped`.
2. Start it and poll faster than the UI does:
   ```bash
   while true; do curl -s $API/agents/$ID -H "$AUTH" | jq -r '[.status, .launchContext, .statusReason] | @tsv'; sleep 2; done
   ```
3. **Expected**: sequence is `stopped → deploying → running` only; `failed` never appears (watch ≥ 2 drift cycles, i.e. > 60 s); `running` visible ≤ 10 s after pod ready (SC-002); `statusReason` stays null. Repeat for `POST /agents/:id/restart` from `running` — same guarantee. In the admin, the badge never flashes red and polling never stops mid-launch.
4. Page-reload check (FR-005): reload the agent page mid-deploy — overlay still shows the in-progress state.

## S2 — Restart with the log panel open: no raw 400 dump (P2; FR-006/007, SC-004)

1. Open the agent page with the Logs panel visible. Restart the agent.
2. **Expected**: during the pod-less window the panel shows the friendly placeholder; while the container is created it shows the spinner state ("Container creating…") — never a `[log fetch failed: HTTP-Code: 400 …]` dump. Confirm at the API layer too:
   ```bash
   curl -s $API/agents/$ID/logs?tail=100 -H "$AUTH" | jq -r .logs
   # during ContainerCreating must print: [container containercreating]
   ```
3. Logs resume automatically once the new pod is up — no manual reload (FR-007).

## S3 — First deploy: distinct copy + clean startup log (P2/P3; FR-003/008/012, SC-003/005)

1. Create a brand-new agent (`POST /agents` / admin create flow).
2. **Expected**:
   - Response has `launchContext: "initial"`, `firstDeployedAt` set after submit; the overlay/log placeholder uses the first-start wording, NOT "Cancelling old workflow…" / "Agent is restarting…" (SC-003 — visibly different from S1's restart copy).
   - Startup log: `mcp connecting to 1 server(s): CleanSlice` followed by `total N tools registered` with **N > 0**; no `connect failed` line; no line styled as ERROR in the admin panel (SC-005).
3. Restart the same agent → `launchContext: "restart"` and restart wording.

## S4 — Genuine failure still surfaces, with a reason (FR-009, SC-006)

1. Force a real failure: point the agent template at a nonexistent image (or otherwise trigger `ImagePullBackOff`).
2. **Expected**: status reaches `failed` within 60 s of the signal, `statusReason` names the cause (e.g. image pull), the admin shows the failed overlay with the reason. No suppression or delay compared to today.

## S5 — 5-minute safety timeout (FR-002 clause b)

1. Make the pod unschedulable (e.g. impossible resource requests) and deploy.
2. **Expected**: status stays `deploying` for the full 5 minutes (no `failed` from the drift sweep during the window), then flips to `failed` with `statusReason` ≈ "startup did not produce a running agent within 5 minutes" within the next drift cycle (≤ ~30 s after expiry).

## S6 — CleanSlice MCP row healed on boot (FR-012)

1. With a DB whose built-in CleanSlice row still holds the bare origin URL, boot the API.
2. **Expected**:
   ```bash
   curl -s $API/mcp-servers -H "$AUTH" | jq '.[] | select(.builtIn) | .url'
   # → "https://mcp.cleanslice.org/mcp"
   curl -s -X POST https://mcp.cleanslice.org/mcp -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}'
   # → 200 (serverInfo: cleanslice-mcp)
   ```
   Re-boot the API → row unchanged (heal is idempotent). S3 then proves agents pick it up on deploy.

## S7 — Regression sweep

- `restart_agent` via the rancher MCP tool actually restarts (pod is replaced; agent does not decay to `failed` after 30 s).
- Dev-only (mock workflow provider): restart the API while an agent's runtime stays connected → the agent must NOT flip to `failed` ("deploy workflow failed") on the next `GET /agents/:id`, and must not ping-pong `failed`↔`running` (bridle-truth guard + mock getStatus throwing for forgotten workflows).
- Stop an agent whose runtime WS is still connected (always the case on local dev) → status stays `stopped` (no bridle-truth resurrect to `running`, no later decay to `failed`), and the chat shows the "Agent stopped" overlay even though the socket is technically alive.
- Opening the agent page issues exactly ONE `GET /agents/:id` (the chat widget is seeded via `initial-debug-enabled` instead of fetching its own copy).
- Restart while `deploying` (restart requested mid-deploy) → the display stays in a single coherent startup state, the grace window re-anchors, and the launch ends `running` — no oscillation, no `failed`.
- Stop while `deploying` → clean `stopped`, no later `failed` from leftover sweeps.
- Rapid stop → start → stop → start remains coherent (FR-010 edge case).
- 20× S1 cycles for SC-001/SC-004 sign-off before release (deploys ship only on `v*` tags).
