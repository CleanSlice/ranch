# Contract: proposal events on the bridle socket (CLEAN-112)

Hub → browser only. The agent runtime never sees or sends these; nothing changes in the agent → hub protocol. Both consoles (`admin/slices/bridle`, `app/slices/bridle`) handle them; the app renders read-only.

## `proposal`

Sent by the API to the active turn's client (`IBridleGateway.findActiveTurn(chatAgentId)` → `sendToClient(clientId, chatAgentId, …)`) when `write_agent_file`, `create_agent_file` or `import_agent_files` creates a proposal. If there is no active turn the event is not sent; the proposal still appears on reload through the transcript's `proposals`.

```ts
interface IBridleProposalEvent {
  type: 'proposal';
  clientId: string;
  turnId: string;
  ts: number;                       // epoch ms, = proposal.createdAt
  proposal: FileChangeProposalDto;  // see contracts/files.openapi.yaml
}
```

Rendering rules (both consoles):

- The card is its own agent-side bubble placed by `ts` (after the assistant text streamed so far, before whatever the agent says next).
- `kind: 'single'` with `inlineDiff` → path, "line N", `+a −d`, **Open in Files**, the hunks (added/removed line styling, context lines), actions.
- `kind: 'single'` without `inlineDiff` → same header, a one-line reason (`diffStatus` `too_large` → "too large to compare", otherwise "large change: +a −d") and **View diff in Files** instead of hunks.
- `kind: 'set'` → "Import into «target»: +add ~change −remove, N skipped", first `summary.rows` paths with their action, "and M more", **Open in Files**; never a diff.
- Actions **Apply / Edit before applying / Skip** only when `status === 'pending'` **and** the console is admin. `mode: 'replace'` with `counts.remove > 0` → Apply opens a second acknowledgement naming the count.
- `applied` → "Applied · HH:MM" + when `restartRequired`: "applies on next restart" with **Restart now / Later** (admin only; existing restart action).
- `skipped` → "Skipped"; `stale` → "File changed since this was proposed — ask the agent to propose again"; `refused` → the reason.

## `proposal_update`

Broadcast by the API to every client of `chatAgentId` (new `IBridleGateway.sendToAgentClients(agentId, data)`) whenever a proposal leaves `pending`, from any path (card, tool confirm, editor save, sibling applied).

```ts
interface IBridleProposalUpdateEvent {
  type: 'proposal_update';
  ts: number;
  proposalId: string;
  status: 'applied' | 'skipped' | 'stale' | 'refused';
  actedBy: string | null;
  actedVia: 'card' | 'tool' | 'editor' | null;
  actedAt: number;
  result?: unknown;                 // ImportResult for sets, { etag } for singles
  restartRequired?: boolean;
}
```

Store rule (`docs/state.md`): the proposal lives once in the `fileProposal` store; the conversation holds ids. `proposal` upserts; `proposal_update` patches; console-initiated Apply/Skip patch optimistically and roll back on error. A `proposal_update` for an unknown id is fetched (`GET …/proposals/:id`) rather than dropped.

## Transcript merge (reload)

`GET /api/agent/:id/transcript` returns `proposals` for the requested channel whose `createdAt` falls inside the page's message time range (plus any still `pending`, regardless of range, so an unanswered card is never lost). The store inserts each as a card bubble at `createdAt`. Cards from earlier pages arrive with those pages.

## Capability flag

The client handshake `capabilities` gains `'proposals'` so a future runtime-side surface could opt out; the hub sends `proposal`/`proposal_update` only to clients that declared it (both consoles do).

## Follow-up user message after Apply (console-side)

After a successful **Apply** from the card, the admin console sends, through its ordinary composer path, the text `Applied change to <path>` (or `Applied import into <agent>`), so the agent's next turn can acknowledge. It is a normal user message in the transcript; the API adds nothing.
