# Data model: agent cards, peers, delegations, delegation step

**Ticket**: [CLEAN-74](https://dreamvention.atlassian.net/browse/CLEAN-74) · Decisions: [research.md](./research.md) §3 · Wire shapes: [contracts/a2a-api.md](./contracts/a2a-api.md)

Two new Prisma models (one additive migration), one derived object (the card), one in-memory object (the task), and one additive shape on an existing wire type (the thinking step).

## 1. `AgentPeer` — a directed connection (new table)

Fragment: `api/src/slices/agent/peer/peer.prisma`, imports `Agent` from `../agent/agent`.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Peer connection id — also the `jti`-like identity the credential is scoped to |
| `agentId` | `String` | **Caller** (the agent that holds the card). FK → `Agent`, `onDelete: Cascade` |
| `peerAgentId` | `String` | **Peer** (the agent whose card is held). FK → `Agent`, `onDelete: Cascade` — see "gone" below |
| `token` | `String @unique` | Pair credential `ap_` + 43 base64url chars, plaintext (R4). Presented by the caller as `Authorization: Bearer` to the peer's A2A endpoint. Never returned by any DTO |
| `cardSnapshot` | `Json` | The peer's `AgentCard` as read at connect/refresh (contracts §1). The tool and the picker read this, never a live card |
| `cardUrl` | `String` | Absolute URL the snapshot was read from — `<api_public_url>/a2a/agents/<peerAgentId>/.well-known/agent-card.json` |
| `cardReadAt` | `DateTime` | Snapshot time; shown in the list |
| `createdAt` / `updatedAt` | `DateTime` | Prisma defaults |

Constraints and rules:

- `@@unique([agentId, peerAgentId])` — one connection per direction (spec Story 2 scenario 6). The reverse direction is a different row.
- `agentId != peerAgentId` — enforced in `PeerService.connect` (self-connection refused with `PEER_SELF`); also refused in the picker.
- **Directed**: reading peers of A returns rows where `agentId = A`. Nothing is inferred from rows where `peerAgentId = A`.
- **"Gone" peer**: the FK cascades, so a deleted peer agent removes the row. The "marked as gone" state of the spec is therefore transient and derived: the list endpoint joins the peer agent and reports `peerExists: false` only when the agent row is missing at read time (which cannot happen after cascade) — in practice the entry disappears and the tool's description no longer lists it. Kept in the DTO for the second-installation future where the peer is remote.
- Indexes: `@@index([agentId])`, `@@index([peerAgentId])`.

Relations added on `Agent` (in `agent.prisma`): `peers AgentPeer[] @relation("AgentPeerCaller")`, `peerOf AgentPeer[] @relation("AgentPeerTarget")`.

## 2. `AgentDelegation` — one task handed to a peer (new table)

Fragment: `api/src/slices/agent/peer/delegation.prisma` (same slice). Shape copies `PaddockEvaluation` (status / startedAt / finishedAt / error).

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(uuid())` | Also the A2A `taskId` returned to the caller and the thinking step id suffix |
| `agentId` | `String` | Caller. FK → `Agent`, `onDelete: Cascade`, `@@index` |
| `peerId` | `String?` | FK → `AgentPeer`, `onDelete: SetNull` — the record outlives a removed connection |
| `peerAgentId` | `String` | Denormalised so the audit row still names the peer after `peerId` is nulled |
| `peerName` | `String` | Peer name at the time (from the snapshot) |
| `contextId` | `String` | A2A `contextId`; same value across follow-ups within one turn (FR-010) |
| `turnId` | `String?` | Caller's thinking turn, when known (R8) |
| `clientId` | `String?` | Caller's chat client the step was pushed to, when known |
| `task` | `String` | Text sent to the peer |
| `reason` | `String` | The caller model's one-line reason (tool argument) |
| `matchedSkills` | `Json` | `[{ id, name }]` — snapshot skills quoted in the step |
| `status` | `String` | `waiting` → `answered` \| `failed` \| `rejected` (see §2.1) |
| `errorCode` | `String?` | `PEER_NOT_RUNNING` \| `PEER_TIMEOUT` \| `PEER_REJECTED_LOOP` \| `PEER_REJECTED_DEPTH` \| `PEER_UNAUTHORIZED` \| `PEER_UNREACHABLE` \| `PEER_ERROR` |
| `excerpt` | `String?` | First 300 characters of the reply, or the failure cause in product wording |
| `startedAt` | `DateTime @default(now())` | |
| `finishedAt` | `DateTime?` | |
| `durationMs` | `Int?` | `finishedAt - startedAt` |

Indexes: `@@index([agentId, startedAt])`.

### 2.1 Status transitions

```
waiting ──answered──► answered   (peer task TASK_STATE_COMPLETED)
   │
   ├──failed────────► failed     (PEER_NOT_RUNNING | PEER_TIMEOUT | PEER_UNREACHABLE | PEER_UNAUTHORIZED | PEER_ERROR)
   │
   └──rejected──────► rejected   (peer task TASK_STATE_REJECTED: PEER_REJECTED_LOOP | PEER_REJECTED_DEPTH)
```

A row is created in `waiting` **before** the HTTP call (so a crash mid-call still leaves an audit row) and finalised exactly once. There is no `canceled`: the caller cannot cancel in this feature.

Retention: none in this feature; rows are small and bounded by chat volume. A prune is a later concern.

## 3. `AgentCard` — derived, never stored except as a snapshot

Built by `AgentCardService.build(agentId)` from `Agent`, `Template`, `Skill[]`, `Knowledge[]`. Exact JSON in [contracts §1](./contracts/a2a-api.md#1-agent-card). Derivation rules:

| Card field | Source |
|---|---|
| `name` | `agent.name` |
| `description` | `agent.config.description` if present, else `template.description` — never empty (falls back to `"Ranch agent «<name>»"`) |
| `version` | `template.version ?? '1'` |
| `supportedInterfaces[0]` | `{ url: <api_public_url>/a2a/agents/<id>, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }` |
| `capabilities` | `{ streaming: false, pushNotifications: false, extensions: [] }` |
| `defaultInputModes` / `defaultOutputModes` | `['text/plain']` |
| `skills[]` from template skills | `{ id: 'skill:<skill.id>', name: skill.title, description: skill.description ?? skill.title, tags: ['skill'] }` |
| `skills[]` from knowledge bases | `{ id: 'knowledge:<kb.id>', name: kb.name, description: 'Answers questions about «<kb.name>»' + (kb.description ? ': ' + kb.description : ''), tags: ['knowledge'] }` — effective bases = `agent.knowledgeIds` if non-empty else `template.defaultKnowledgeIds`, filtered through `findExistingByIds` |
| `securitySchemes` | `{ peerBearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } }` |
| `securityRequirements` | `[{ schemes: { peerBearer: { list: [] } } }]` |
| `provider` | `{ organization: 'Ranch', url: <api_public_url> }` |

Rules: skills may be empty (spec edge case); the card never mentions peers (FR-019); the card is rebuilt on every read (FR-001) — no cache.

## 4. `A2aTask` — in-memory, per receiving agent

`Map<taskId, { task: A2aTask, expiresAt }>` in `A2aTaskStore`, TTL 10 minutes, swept lazily on access and by a 1-minute interval. Holds exactly what `SendMessage` returned so `GetTask` can repeat it. `contextId` is the caller-supplied value (or minted when absent). Not persisted (R12).

## 5. Delegation thinking step — additive fields on `IBridleThinkingStep`

`api/src/slices/bridle/domain/bridle.types.ts` (mirrored in `admin/slices/bridle/stores/bridle.ts`):

```ts
interface IBridleThinkingStep {
  id: string;            // 'delegation:<delegationId>' for delegation steps
  label: string;         // 'Asking «B»' | 'Answered by «B»' | 'Could not reach «B»'
  detail?: string;       // markdown fallback for generic renderers (see contracts §4)
  state: 'active' | 'done';
  kind?: 'delegation';   // NEW, optional — absent on runtime steps
  delegation?: {         // NEW, present iff kind === 'delegation'
    delegationId: string;
    peerAgentId: string;
    peerName: string;
    matchedSkills: { id: string; name: string }[];
    reason: string;
    task: string;
    status: 'waiting' | 'answered' | 'failed' | 'rejected';
    startedAt: number;   // epoch ms — the client derives elapsed time while waiting
    durationMs?: number;
    excerpt?: string;    // reply excerpt (answered) or cause in product wording (failed/rejected)
  };
}
```

The step is emitted twice per delegation with the same `id`: once at start (`state: 'active'`, `status: 'waiting'`) and once at the end (`state: 'done'`, final status). The admin store already replaces a step by id.

## 6. Identity strings used across the feature

| String | Format | Where |
|---|---|---|
| Peer credential | `ap_` + 43 base64url chars | `AgentPeer.token`; bearer to `/a2a/agents/:peerAgentId` |
| Bridle client id for a peer conversation | `peer:<callerAgentId>:<contextId>` | registered by the A2A server on the peer agent; gives the peer's runtime one conversation per (caller, context) |
| Thinking step id | `delegation:<delegationId>` | caller's thinking timeline |
| Card skill ids | `skill:<skillId>`, `knowledge:<knowledgeId>` | card and `matchedSkills` |
| Chain | `metadata.ranch.chain: string[]` of agent ids, oldest first, caller last | every `SendMessage` |
