# Quickstart validation: CLEAN-74 agent cards, peers, visible delegation

Prerequisites: local stack per `README.md` (`make dev`, or `ranch dev`), two deployable agents, one knowledge base with at least one indexed document on a topic the other agent knows nothing about. Contracts: [contracts/a2a-api.md](./contracts/a2a-api.md); model: [data-model.md](./data-model.md).

Set in `api/.env.dev` (optional; defaults work locally):

```bash
API_PUBLIC_URL=http://localhost:3333     # what goes into cards; must be reachable from the API itself
A2A_SYNC_TIMEOUT_MS=120000
A2A_MAX_CHAIN=3
```

## 1. Unit tests (fast loop)

```bash
cd api && bun run test -- peer agentCard a2a askAgent bridleSync bridle.gateway mcp-tools
```

Expected green:

- `PeerService`: mints `ap_` + 43 base64url chars; refuses self (`PEER_SELF`) and duplicates (`PEER_EXISTS`); connect stores the snapshot only after a successful card fetch; refresh keeps the old snapshot on fetch failure; remove deletes the row.
- `AgentCardService`: template skills → `skill:*`, effective knowledge bases → `knowledge:*` (agent override wins over template defaults, missing ids dropped); empty skills allowed; `supportedInterfaces[0].url` absolute; no peers anywhere in the card.
- `A2aController`: card needs Owner/Admin JWT or a peer credential scoped to that agent; JSON-RPC needs the peer credential only; `A2A-Version` other than `1.0` → `-32009`; loop → `TASK_STATE_REJECTED` (`loop`); chain ≥ 3 → `TASK_STATE_REJECTED` (`depth`); agent offline → `TASK_STATE_FAILED` (`not_running`) without touching the hub send; timeout → `TASK_STATE_FAILED` (`timeout`); reply → `TASK_STATE_COMPLETED` with one text artifact; `GetTask` returns the same task, unknown → `-32001`; every other method → `-32004`.
- `AskAgentTool`: not listed for an agent with no peers; description lists peers with skills; unknown peer name → `isError` listing the peers; success text carries name, context id, time; failure texts tell the model not to guess; a delegation row is created before the HTTP call and finalised after; the step is pushed twice with the same id when an active turn is known and not at all when none is.
- `BridleSyncService`: resolves on `message` and on `stream_end`, accumulates `stream` chunks, unregisters on timeout, uses a private socket id.
- `BridleGateway.findActiveTurn`: set on a `thinking` step, cleared on `done` and on client unregister, most recent wins.
- `McpToolsHandler`: a tool whose `isListedForRequest` returns `false` is absent from `tools/list` and its `tools/call` returns `isError`.

## 2. Migration, typecheck, client regen

```bash
cd api && bun run migrate            # creates AgentPeer, AgentDelegation (additive)
cd api && bunx tsc --noEmit && bun run build && bun run generate:swagger
cd admin && bun run build:api && bun run typecheck
```

Expected: the generated SDK has `listAgentPeers`, `listAgentPeerCandidates`, `getAgentCard`, `connectAgentPeer`, `refreshAgentPeer`, `removeAgentPeer`, `listAgentDelegations`; `admin` typechecks with the new `peers` tab and `DelegationStep.vue`.

## 3. Card and peers by hand (API only)

```bash
TOKEN=<console JWT of an owner>          # from the admin login response
B=<agent B id>; A=<agent A id>

# B's own card, as an operator
curl -s -H "Authorization: Bearer $TOKEN" localhost:3333/agents/$B/card | jq .data.skills

# B's card at its well-known address (still needs a credential)
curl -s -o /dev/null -w "%{http_code}\n" localhost:3333/a2a/agents/$B/.well-known/agent-card.json      # 401
curl -s -H "Authorization: Bearer $TOKEN" localhost:3333/a2a/agents/$B/.well-known/agent-card.json | jq .name

# connect B to A, then list
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"peerAgentId\":\"$B\"}" localhost:3333/agents/$A/peers | jq '.data | {peerName, cardReadAt, skills: .card.skills | length}'
curl -s -H "Authorization: Bearer $TOKEN" localhost:3333/agents/$B/peers | jq '.data | length'          # 0 — directed
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"peerAgentId\":\"$A\"}" localhost:3333/agents/$A/peers -w "%{http_code}\n"                    # 400 PEER_SELF
```

Expected: the card lists one `skill:*` per template skill and one `knowledge:*` per bound base; the peers list of B is empty; self-connect is refused; a second connect of B to A returns 409.

Then, with the pair credential read from the DB (`select token from "AgentPeer"`), send a task as A would:

```bash
AP=ap_...
curl -s -X POST localhost:3333/a2a/agents/$B -H "Authorization: Bearer $AP" -H 'A2A-Version: 1.0' -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"SendMessage",
  "params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"What is the return window for shoes?"}],
  "metadata":{"ranch":{"chain":["'$A'"]}}}}}' | jq '.result.task.status.state, .result.task.artifacts[0].parts[0].text'
```

Expected with B running: `TASK_STATE_COMPLETED` and B's answer. With B stopped: `TASK_STATE_FAILED` and `status.message` "peer not running" **immediately**, not after 120 s. With `"chain":["'$B'"]`: `TASK_STATE_REJECTED` "would loop". With a 3-element chain: `TASK_STATE_REJECTED` "too deep". With a console JWT instead of `ap_`: 401.

## 4. The demo, end to end (admin console)

1. Agent **B**: template with at least one skill; bind the knowledge base; deploy; ask B a question from the base in its chat and confirm it answers with a citation.
2. Agent **A**: no knowledge base. Deploy. Ask the same question → A says it does not know; **no delegation step** appears in the thinking block.
3. On A → **Peers** tab: the "Agent card" section at the top shows A's own card. Press **Add peer**, pick B, the preview shows B's name, description and skills; **Connect**. B appears in the list with skills and "read just now". The restart banner appears.
4. **Restart A** (the list of tools is read at boot — research R7). When A is back, ask the same question.
5. Watch the thinking block: within a second a step **Asking «B»** appears with the matched skill badge, A's reason, the task text, and a running timer. It then turns into **Answered by «B»** with the duration and an excerpt. A's reply contains the fact and names B as the source.
6. Collapse the thinking block and expand it again: the delegation step is still there with the same content.
7. Stop B. Ask again: the step ends as **Could not reach «B»** with "peer not running", and A's reply says it could not get this from B.
8. On A → Peers → **Recent delegations** shows both rows (answered, failed) with durations.
9. On B → Peers: A is **not** listed. Remove B from A's peers, restart A, ask again: A says it does not know, no step.

Success criteria checked here: SC-001 (≤ 3 interactions to connect), SC-002/SC-004 (attribution and honest failure), SC-003 (step ≤ 1 s, timer never idle), SC-007 (step 2 and step 9 look exactly like before the feature).

## 5. In-cluster check

On the dev cluster, repeat §4 steps 3–5 once. What is being verified: `api_public_url` resolves to a URL the API pod can reach itself (the card's `supportedInterfaces[0].url` works from inside the cluster), and a delegation completes while the MCP session of A's pod stays alive. Also confirm on a real pod that the runtime emits at least one thinking step before `ask_agent` runs — if the delegation step never appears although the reply is correct, that assumption (research §4) has failed and the step falls back to nothing; record it on the ticket.

## 6. Loop and depth, live

Connect A → B **and** B → A. Restart both. Give B a card that tempts it to call A (describe A as the expert on the question). Ask A: the step on A shows **Answered by «B»** (B tried A, got "would loop", answered itself). B's Recent delegations shows one `rejected` row with `PEER_REJECTED_LOOP`.
