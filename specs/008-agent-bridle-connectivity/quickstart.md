# Quickstart validation: CLEAN-55 agent bridle connectivity

Prerequisites: local stack per `README.md` (api on Bun, k3d cluster for agent pods, admin dev server). Contracts: [contracts/agent-status-api.md](./contracts/agent-status-api.md); state machine: [data-model.md](./data-model.md).

## 1. Unit tests (fast loop)

```bash
cd api && bunx jest agentStatus agentDeploy
```

Expected: new `agentStatus.service.spec.ts` green — demote-after-grace, no-demote-within-grace/deploy-grace, `stopped` untouched, `connected` promotes `unreachable`→`running` + clears reason, pod-ready does NOT promote out of `unreachable`, snapshot carries `bridleConnected`; `agentDeploy` warns + writes reason on empty settings.

## 2. Typecheck + client regen

```bash
cd api && bunx tsc --noEmit && bun run generate:swagger
cd ../admin && bun run build:api && bun run typecheck
```

Expected: `AGENT_STATUS_VARIANT` and other status maps fail typecheck until `unreachable` is added everywhere (this is the safety net), then pass.

## 3. E2E — reproduce the incident, watch it get diagnosed

1. Admin → `/settings/bridle`: clear **Bridle API key** (leave URL), save.
2. Deploy any agent from the admin.
3. **Immediately** (status `deploying`): `curl -s localhost:3333/agents/status | jq '.[] | select(.agent.id=="<ID>") | .agent.statusReason'` → deploy-time warning naming `integrations/bridle_api_key` and `/settings/bridle`; API logs show the warn line.
4. Pod becomes Running+Ready → status flips to `running`, `bridleConnected: false` in the same payload; admin list must NOT show plain green (intermediate "waiting for runtime" presentation).
5. ≤ ~90 s later (60 s grace + sweep): status becomes `unreachable`, reason = sweep diagnostic; admin list/RuntimeCard shows the distinct badge + tooltip with the reason.
6. Open the agent chat: input disabled, and instead of a bare "Agent is not connected" the hint shows — env preview link (`/agents/:id` env tab), `/settings/bridle` link, "restart required" note.
7. Fix: restore the API key in `/settings/bridle`, restart the agent from the admin.
8. Runtime registers on `/ws/agent` → within seconds status returns to `running`, reason cleared, `bridleConnected: true`, chat input enabled. SSE consumers see both flips without reload.

## 4. False-positive guards (SC-003)

- **API restart**: `docker restart`/redeploy the api process while agents run → for the first ≤60 s all agents report `bridleConnected: false` but NO agent may flip to `unreachable`; after runtimes reconnect everything stays `running`.
- **Stopped agent**: stop an agent → status `stopped` stays, never `unreachable`.
- **Fresh healthy deploy**: deploy with correct settings → agent goes `deploying` → `running`, no transient `unreachable`, no reason ever written.

## 5. Public-endpoint check (FR-011)

```bash
curl -s localhost:3333/agents/status | jq '.[0]' | grep -iE 'api_key|token|password' ; echo "exit=$? (expect 1 — no secrets)"
```
