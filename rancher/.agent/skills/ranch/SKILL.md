---
name: ranch
description: Operate the Ranch — manage agents, templates, skills, LLMs, knowledge, users, settings via the ranch_* MCP tools or the http tool. Use this skill whenever the operator asks anything about agents, templates, skills, deployments, LLM credentials, knowledge bases, users, usage, secrets, or platform settings.
metadata:
  emoji: "🤠"
  always: true
---

# Ranch Skill — Operating the Platform

You have **two ways** to act on the Ranch. Use the right one for the right job.

1. **`ranch_*` MCP tools** — fast shortcuts auto-attached because you have `RANCH_ADMIN=true`. They cover the most common reads and a handful of mutations. Call them by their exact names from the table below.
2. **`http` tool against `${RANCH_API_URL}`** — universal interface; everything the API can do is reachable here, including all the ops that don't have an MCP shortcut. Always available.

This skill is `always: true` because every operator request touches at least one of these resources.

---

## MCP tool catalogue (real names — these are the ONLY ones)

| Domain | Tool | Purpose |
|--------|------|---------|
| **Agents** | `list_agents` | every agent on the ranch with status, template, resources |
|            | `get_agent` (id) | single agent's status / workflowId / config |
|            | `restart_agent` (id) | queue restart of an agent's pod |
|            | `set_agent_admin` (id, enabled) | promote / demote (single-admin invariant — enabling clears the flag elsewhere) |
| **Templates** | `list_templates` | all templates |
|               | `get_template` (id) | template + image + defaults + attached skill ids |
|               | `set_template_skills` (id, skillIds) | EXHAUSTIVE — sends the full skill list, omitted ids get detached |
| **Skills** | `list_skills` | inventory |
| **LLMs** | `list_llms` | configured credentials (provider, model, status) |
| **Settings** | `list_settings` (group?) | all platform settings, optionally filtered by group |
|              | `upsert_setting` (group, name, value, valueType?) | create / replace; `valueType=string` for strings, `json` for objects/numbers/arrays |
| **Agent files** | `list_agent_files` (agentId) | files in agent's S3 prefix (mounted into pod's `.agent/`) |
|                 | `read_agent_file` (agentId, path) | one file (`SOUL.md`, `MEMORY.md`, `agent.config.json`, …) |
|                 | `write_agent_file` (agentId, path, content) | only `.md` and `.json` accepted; restart the agent for changes to apply |
| **Usage** | `agent_usage` (agentId, days?) | recent token usage records (default 30 days) |

**Anything not in this table — there is no `ranch_*` shortcut.** Don't invent names. Use `http` (next section).

---

## HTTP fallback — for everything not in the table above

The Ranch API has many endpoints that don't have a dedicated MCP tool. Use the `http` tool with the env vars guaranteed on your pod:

- `RANCH_API_URL` — base URL (e.g. `http://api:3000` in-cluster)
- `RANCH_API_TOKEN` — Bearer JWT, role `Owner`

```
http({
  url: "${RANCH_API_URL}/<path>",
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  headers: { "Authorization": "Bearer ${RANCH_API_TOKEN}", "Content-Type": "application/json" },
  body: "<json>"  // when applicable
})
```

### Common HTTP-only routes

| What | Method · Path |
|------|---------------|
| Create agent | POST `/agents` body `{ name, templateId, llmCredentialId?, isAdmin? }` |
| Update agent | PUT `/agents/{id}` |
| Delete agent | DELETE `/agents/{id}` |
| Agent live pod state | GET `/agents/status` |
| Agent secrets list | GET `/agents/{id}/secrets` |
| Agent logs | GET `/agents/{id}/logs?tail=200` |
| Set agent debug | PATCH `/agents/{id}/debug` body `{ enabled }` |
| Create template | POST `/templates` |
| Update template | PUT `/templates/{id}` |
| Delete template | DELETE `/templates/{id}` |
| Template files | GET·PUT `/templates/{id}/files[?path=]` |
| Skill CRUD | POST·PUT·DELETE `/skills[/{id}]` |
| Search GitHub skills | GET `/skills/search?q=<term>` |
| Import skill from GitHub | POST `/skills/import` body `{ url }` |
| LLM credential CRUD | POST·PUT·DELETE `/llms[/{id}]` |
| Knowledge bases · CRUD | GET·POST·PUT·DELETE `/knowledges[/{id}]` |
| Query knowledge | POST `/knowledges/{id}/query` body `{ query }` |
| List users | GET `/users` |
| Invite user | POST `/users/invite` body `{ email, roles }` |
| User CRUD | PUT·DELETE `/users/{id}` |
| Delete a setting | DELETE `/settings/{group}/{name}` |
| OpenAPI spec (full surface) | GET `/api-json` — fetch this if you need to introspect any endpoint |

For anything not listed: fetch `/api-json` and pick the right route.

---

## Workflow Recipes

### 1. Deploy a new agent

```
operator: "spawn an agent named Knox using the default template with our Claude key"

1. list_templates                                 → find the default template's id
2. list_llms                                      → find the active Claude credential id
3. http POST ${RANCH_API_URL}/agents body {
     name: "Knox",
     templateId: <template-id>,
     llmCredentialId: <llm-id>
   }                                              → returns the new agent + status
4. get_agent({ id })                              → confirm pod is healthy (after a moment)
```

Report back: `Knox spawned · agent-<id> · status: pending → running`.

---

### 2. Restart an agent

```
operator: "restart Knox"

1. list_agents                                    → resolve "Knox" → agent id
2. restart_agent({ id })                          → returns 202 + new pod
3. (after 10-60s) get_agent({ id })               → confirm running
```

Don't wait synchronously for `running` — pods take 10-60s. Report the restart and the current status; if the operator wants confirmation, schedule a 60-second `cron_add` follow-up.

---

### 3. Add a new LLM credential

```
operator: "add a DeepSeek key: sk-..."

http POST ${RANCH_API_URL}/llms body {
  provider: "deepseek",
  model: "deepseek-chat",
  apiKey: "sk-...",
  status: "active"
}                                                 → returns the new credential

(optional) list_llms                              → confirm visible
```

**Never log or echo the API key** in your reply. Confirm with `Saved · deepseek-chat · llm-<id>`.

---

### 4. Create a new template

Most operators want to copy an existing template + tweak it. Workflow:

```
operator: "make a new template like 'default' but call it 'researcher' with 1Gi memory"

1. get_template({ id: <default-id> })             → get the source template
2. http POST ${RANCH_API_URL}/templates body {
     name: "researcher",
     description: "...",
     image: "<copied>",
     defaultResources: { cpu: "500m", memory: "1Gi" },
     defaultConfig: { ...copied... }
   }                                              → returns new template id
3. (optional) attach skills:
   set_template_skills({
     id: <new-template-id>,
     skillIds: [<skill-id>, ...]
   })
```

To copy template files (SOUL.md, skills, etc.) from the source:

```
4. http GET ${RANCH_API_URL}/templates/<source-id>/files
5. for each file:
   - http GET ${RANCH_API_URL}/templates/<source-id>/files?path=<rel>
   - http PUT ${RANCH_API_URL}/templates/<new-id>/files body { path, content }
```

**Tip:** `template-rancher` is a special id — it's *your own* template. Don't recreate or delete it. If the operator asks you to "redeploy yourself", use `restart_agent` on the admin agent instead.

---

### 5. Wire a skill to a template

```
operator: "give the 'researcher' template the websearch skill"

1. http GET ${RANCH_API_URL}/skills/search?q=websearch  → resolve to skill-id
2. get_template({ id: <template-id> })            → get current skillIds
3. set_template_skills({
     id,
     skillIds: [...currentSkillIds, <new-skill-id>]
   })                                             → IMPORTANT: include all existing IDs, the call replaces the full set
```

**Gotcha:** `set_template_skills` REPLACES the full list. If you only pass the new id, all other skills get detached. Always merge.

---

### 6. Edit a template's SOUL.md (or any template file)

```
operator: "update the researcher's soul to focus on academic citation"

1. http GET ${RANCH_API_URL}/templates/<template-id>/files?path=SOUL.md
2. craft the new content
3. http PUT ${RANCH_API_URL}/templates/<template-id>/files body {
     path: "SOUL.md",
     content: "<full new file>"
   }
```

Only `.md` and `.json` are accepted. For binary assets, talk to the operator.

---

### 7. Edit an agent's files (SOUL.md, MEMORY.md, agent.config.json…)

```
operator: "add to Knox memory: user prefers metric units"

1. read_agent_file({ agentId: "agent-knox-...", path: "MEMORY.md" })
2. craft merged content (preserve existing!)
3. write_agent_file({ agentId, path: "MEMORY.md", content: "<full new file>" })
4. restart_agent({ id: agentId })                 → so the change applies
```

Same `.md` / `.json`-only rule applies. `list_agent_files` to discover.

---

### 8. Knowledge base

Knowledge bases don't have `ranch_*` shortcuts — pure HTTP:

```
# Create + add a source + index
1. http POST ${RANCH_API_URL}/knowledges body { name: "..." }
2. http POST ${RANCH_API_URL}/knowledges/<id>/sources body {
     type: "url" | "file" | "github",
     value: "..."
   }
3. http POST ${RANCH_API_URL}/knowledges/<id>/index   → trigger indexing job

# Query
http POST ${RANCH_API_URL}/knowledges/<id>/query body { query: "...", k: 5 }
```

When the operator asks "what does our docs say about X?" — that's a knowledge query, not a guess from memory.

---

### 9. Invite / manage users

```
operator: "invite alice@example.com as admin"

http POST ${RANCH_API_URL}/users/invite body {
  email: "alice@example.com",
  roles: ["admin"]
}
```

Roles: `owner`, `admin`, `viewer`. Confirm with `Invited · alice@example.com · admin`.

---

### 10. Usage / billing

```
operator: "how much did Knox spend this week?"

1. list_agents                                    → resolve "Knox" → agent id
2. agent_usage({ agentId, days: 7 })              → totals for the window
```

Format: `Knox · 7d · YY,YYY tokens · Z calls`.

For a ranch-wide picture, iterate `list_agents` then `agent_usage` per agent and aggregate. If the operator asks this often, save the routine to memory and offer a `cron_add` weekly digest.

---

### 11. Settings

Settings hold integration keys (`s3_*`, `aws_*`), feature flags, default images, etc. Grouped by `group` / `name`.

```
# Read
list_settings                                     → all settings
list_settings({ group: "integrations" })          → narrow to one group

# Write
upsert_setting({
  group: "integrations",
  name: "s3_bucket",
  value: "ranch-prod",
  valueType: "string"                             // "json" for non-string values
})
```

**Never echo secret values back.** If asked "what's the S3 key set to?" — confirm presence (`s3_access_key_id is set`) without revealing the value.

---

### 12. Logs / debugging

```
operator: "Knox is acting up"

1. get_agent({ id })                              → check status, workflowId
2. http GET ${RANCH_API_URL}/agents/<id>/logs?tail=200
3. (only if needed) http PATCH ${RANCH_API_URL}/agents/<id>/debug body { enabled: true }
```

Turn debug back off when done — it's noisy.

---

### 13. Promote/demote admin

```
operator: "make Knox the ranch admin"

1. list_agents                                    → resolve "Knox" → id
2. set_agent_admin({ id, enabled: true })         → promotes Knox; existing admin (you) gets demoted
```

Single-admin invariant: exactly one agent has the flag. Enabling on someone else clears it on you.

---

## Resolving Names → IDs

Operators talk in names ("Knox", "researcher", "the Claude key"). Tools take IDs. The pattern:

1. Call the relevant `list_*` tool (`list_agents`, `list_templates`, `list_llms`, `list_skills`).
2. Filter the response client-side — match on `name` (case-insensitive substring).
3. If 0 matches → tell the operator and list candidates.
4. If 1 match → proceed.
5. If 2+ matches → ask which one (show id + name + a disambiguator like createdAt or status).

Never invent an ID. If you guess and it's wrong, the API returns 404 — but worse, if you guess and it's *right* but for the wrong resource, you may delete or restart the wrong thing.

---

## Common Gotchas

- **`set_template_skills` replaces the full set.** Always merge before sending.
- **`template-rancher` is your own template.** Don't delete or recreate it. To rebuild yourself, `restart_agent` on the admin.
- **Deleting a template fails if any agent uses it.** API returns 409. Either delete the agents first or tell the operator.
- **Pod startup is async.** Agent creation returns immediately with `status: pending`. The pod becomes `running` 10-60s later.
- **Settings values are stored verbatim — including secrets.** Never echo them back.
- **`agent_usage` defaults to 30 days.** Pass `days:` explicitly when the operator asks for a different window.
- **`accessStrategy: 'approval'`** (your config) means new chat sessions need operator approval. If a teammate complains they can't reach you — the operator must approve them or switch you to `allowlist`.

---

## When to Decline

Refuse and tell the operator if:

- You'd be deleting yourself, the operator's user, the only active LLM, or `template-rancher`.
- A non-operator user asks for create/update/delete operations (they don't have privileges through you).
- The request would expose a secret value (`apiKey`, `*_secret_*`).

For everything else — the operator owns the platform. Act on their request.
