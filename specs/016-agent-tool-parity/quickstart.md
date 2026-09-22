# Quickstart: proving CLEAN-109 works

Validation guide for the implemented feature. Implementation details are in tasks.md; this file only says how to run and what to expect.

## Prerequisites

- Local stack running: `make dev` (api :3000, admin :3002) with a k3d cluster, or the CLI `ranch dev`.
- An Owner login for the admin console and a Rancher admin agent deployed (Rancher page shows the chat).
- `.env.project` keys are not needed for validation.

## 1. The API refuses to boot a tool without metadata (FR-005)

```bash
cd api
NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/mcp/services/mcp-registry.service.spec.ts
```
Expected: the "validation" cases pass — a provider whose `@Tool` lacks `topic`, `title` or `template`, or is `destructive` without a `confirm` parameter, makes `onApplicationBootstrap` throw with the tool name in the message.

## 2. Every tool file has tests; nothing leaks a secret (FR-004, FR-007)

```bash
cd api
NODE_OPTIONS=--experimental-vm-modules npx jest "\.tool\.spec\.ts$" src/slices/mcp/tool-secrets.spec.ts
```
Expected: green. The secrets spec calls each secret-taking tool with a sentinel and asserts the sentinel is absent from the result, except `create_api_key`.

Never run `bun run test` in `api/` while a dev API is up — it re-runs `prisma generate` and kills the running process.

## 3. The catalogue endpoint returns the live per-agent list (FR-009)

```bash
# token: an Owner bearer from the admin login; AGENT: the Rancher admin agent id
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/agents/$AGENT/tools | jq '.groups[] | {key, kind, afterRestart, n: (.tools|length)}'
```
Expected: builtin groups in topic order (agents, agent_workspace, templates, skills, llm, mcp_servers, knowledge, settings, peers, paddock, users_keys, chats_usage, browser, attachments, platform), each with `n > 0`; external MCP servers from the agent's template as `kind: external` with `n: 0`; no `url` or `authValue` anywhere in the body.

Repeat with a non-admin agent id: operator-only groups are absent (only `knowledge`, `peers` self-service, `browser`, `attachments` remain).

## 4. "After restart" is true, then clears (FR-014, SC-007)

1. With the Rancher agent running, note `podStartedAt` and `listedAt` from step 3.
2. Deploy an API build that adds a tool (or, for a quick check, temporarily rename one tool's `name`); restart only the API.
3. `GET /agents/$AGENT/tools` → the new tool has `inPod: false` and its group `afterRestart: true`.
4. Restart the agent from the console (or `restart_agent`). After the pod reconnects, step 3 shows `inPod: true`, `listedAt` newer than `podStartedAt`.

## 5. The Tools panel (FR-010 … FR-016)

Open the admin console → Rancher page. Beside the paperclip there is a wrench button with a tooltip "Tools".

- Click it: a sheet opens, accordions in topic order, each row shows title, technical name in small type, description. Empty topics are absent.
- Type `mcp` in the search: only MCP-related rows remain across topics, their topics expanded. Clear: previous expansion restored.
- Click "Register an MCP server": the sheet closes, the composer contains the template, the first «…» is selected, nothing was sent. Edit the text and send.
- With a draft already typed, pick a tool: the template is appended with a space, the draft is intact.
- Stop the agent: the panel still opens (no restart markers), the composer is disabled as before.
- After step 4.3: the affected group shows "after restart" with a restart button; clicking it runs the normal restart flow and the marker clears after the pod is back.
- Narrow the window to phone width: the sheet is full-width and scrollable; Tab/Enter reach every row.

Same checks on an agent's Chat tab (`/agents/<id>?tab=chat`).

## 6. Parity through the chat alone (SC-002)

In the Rancher chat, one prompt each, without opening another page:

1. "Register the MCP server at https://example.com/mcp named Example with no auth and attach it to the researcher template" → MCP list shows it, template has it, researcher agents show "pending restart".
2. "Add https://docs.example.com/sitemap.xml to the knowledge base Docs and index it" → sources appear, indexing starts.
3. "Create an LLM credential Test-Anthropic for anthropic with key sk-test… and health-check it" → credential listed, key not in the reply, health result reported.
4. "Create a user Jane with email jane@example.com and make her an admin" → user listed with role admin, after the agent asked for confirmation on the role change.
5. "Create an API key named ci-deploy" → key shown once; "revoke it" → gone after confirmation.
6. "Delete the agent test-bot" → the agent asks to confirm first; "yes" → deleted.

Then, as a non-admin agent (any agent chat in the console): "List the users" → refused with a message naming the operator/console.

## 7. Admin typecheck and util tests

```bash
cd admin
bun test slices
npx nuxt typecheck   # not `bun run typecheck` — it regenerates the SDK; revert generated files if it did
```
Expected: `insertTemplate` and `filterCatalog` specs green; typecheck clean.

## 8. The rule is where people look (FR-018 … FR-020)

- `CLAUDE.md` has an "Agent tools" section linking `docs/agent-tools.md`.
- `.claude/skills/graft/SKILL.md` and `.cursor/rules/graft.mdc` contain the `ranch:agent-tools` block; run `graft init --yes --no-global` and then `node scripts/ensure-agent-tools-rule.mjs` → the block is back.
- `.github/PULL_REQUEST_TEMPLATE.md` has the parity checklist line.
