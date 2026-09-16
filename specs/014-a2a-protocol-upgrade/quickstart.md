# Quickstart validation: CLEAN-95 A2A v2

Prerequisites: local stack per `README.md` (`make dev`), the CLEAN-74 pair scenario
still working (see [013 quickstart](../013-a2a-agent-peers/quickstart.md) §4).
Contracts: [contracts/peers-v2-api.md](./contracts/peers-v2-api.md); model:
[data-model.md](./data-model.md).

## 1. Unit tests (fast loop)

```bash
cd api && bun run test -- peer askAgent a2a mcp-tools
```

Expected green, beyond the existing CLEAN-74 assertions:

- `PeerService`: connect-by-URL canonicalizes both URL forms to one base; re-import of
  the same canonical URL updates in place (same row id) and never inserts; own-base URL
  → `PEER_SELF_URL`; fetch failure persists nothing; internal path byte-identical to
  before.
- `AgentPeerDto` poisoned-stub check extends to `outboundToken`.
- `AskAgentTool`: description contains the give-up rule before the "not a first
  resort" caveat; external peers listed identically to internal; serving the list
  records `peersServedAt`/`peersServedHash`; hash changes on connect/remove, not on
  re-import of the same membership.
- `A2aClient`: no `Authorization` header when no token; `outboundToken` used for
  external fetch and send; external 401 → `PEER_UNAUTHORIZED`.
- Delegation rows for external peers: `peerAgentId` null, `peerId` set.

## 2. Migration, typecheck, client regen

```bash
cd api && bun run migrate && bunx tsc --noEmit && bun run build && bun run generate:swagger
cd ../admin && bun run build:api && bun run typecheck
```

Expected: additive migration only; SDK gains `getAgentPeersState` and the extended
connect body; admin typechecks.

## 3. External import against a mock A2A agent

Run a throwaway A2A endpoint on another port (any static server returning a valid 1.0
card at `/.well-known/agent-card.json` and a JSON-RPC echo on POST — a ~30-line
script; keep it in the scratchpad, not the repo):

```bash
TOKEN=<console JWT>; A=<agent id>
# import by well-known form — stored canonical base must drop the suffix
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:4444/a2a/agents/mock-1/.well-known/agent-card.json","token":"tk_demo"}' \
  localhost:3333/agents/$A/peers | jq '.data | {origin, cardUrl, peerName}'
# re-import same base URL → same row id, updated snapshot, 200
# own installation URL → 400 PEER_SELF_URL
# bad port → 502 PEER_URL_UNREACHABLE (fast, not 120 s)
# state endpoint:
curl -s -H "Authorization: Bearer $TOKEN" localhost:3333/agents/$A/peers/state | jq .data
```

Expected: `armed:false` right after import; after Restart now → `armed:true`.

## 4. The console, end to end

1. Agent workspace tab reads **A2A**; an old `…?tab=peers`-style link still lands there
   (SC-007).
2. Add peer → **By URL** path: paste the mock URL (+credential), preview shows the
   mock's card, Connect. The row appears with the **external** badge; feed filter and
   refresh work on it; the credential is nowhere in any response (check the network
   tab).
3. Header shows **pending restart** + the banner's **Restart now** button; click it;
   when the agent is back the header shows **armed** (SC-005).
4. Ask the agent a question the mock covers → delegation step + feed row, identical to
   internal (FR-009). Kill the mock, ask again → fail-fast cause in the feed.
5. Remove the external peer → row gone; re-import works from scratch.

## 5. The delegation policy, live (SC-001 / SC-002)

Local pair (or production after deploy — see §6): caller A + running peer B whose card
carries a description and ≥1 skill.

- 10× domain questions A cannot answer itself → ≥9 delegated, attributed answers.
- 10× questions naming B outright → 10/10 delegated or a one-sentence why-not; **any
  "I don't know" with B untried and plausible = failure** (FR-011).
- Control: a question inside A's own competence → no delegation (the "not a first
  resort" half still holds).

## 6. Production validation (the CLEAN-95 baseline)

On admin.ranch.cleanslice.org (creds `RANCH_PLATFORM_LOGIN` / `RANCH_PLATFORM_PASS`
from local `.env`; never print them), agent `agent-0db1552e-d8c7-49ac-8184-04ad64a9c55a`:

1. Give Skyhunter's template a description + at least one skill so its card advertises
   something (the 2026-09-16 card was empty — that emptiness is half the baseline).
2. Check `peers/state`: expected `armed:false` explains the historic zero delegations;
   Restart now → `armed:true`.
3. Re-ask the original failing question ("сколько crews в skyhunter") → delegation
   step fires, answer attributed to Skyhunter, first row ever in Recent delegations.
   Record the before/after on CLEAN-95.
