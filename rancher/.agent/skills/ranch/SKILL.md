---
name: ranch
description: Operate the Ranch — manage agents, templates, skills, LLMs, knowledge, users, settings via the ranch_* toolset. Use this skill whenever the operator asks anything about agents, templates, skills, deployments, LLM credentials, knowledge bases, users, usage, secrets, or platform settings.
metadata:
  emoji: "🤠"
  always: true
---

# Ranch Skill — Operating the Platform

The `ranch_*` tools are your operational interface to the Ranch API. Use them aggressively — they are the only correct way to act on the operator's requests. Never simulate, narrate, or guess what would happen — call the tool.

This skill is `always: true` because every operator request touches at least one of these resources.

---

## Tool Map

| Domain | Read | Mutate (admin-only) |
|--------|------|---------------------|
| **Agents** | `ranch_agent_list`, `ranch_agent_get`, `ranch_agent_status` | `ranch_agent_create`, `ranch_agent_update`, `ranch_agent_delete`, `ranch_agent_restart`, `ranch_agent_set_debug` |
| **Templates** | `ranch_template_list`, `ranch_template_get` | `ranch_template_create`, `ranch_template_update`, `ranch_template_delete`, `ranch_template_set_skills` |
| **Template files** | `ranch_template_file_list`, `ranch_template_file_read` | `ranch_template_file_save` |
| **Skills** | `ranch_skill_list`, `ranch_skill_get`, `ranch_skill_search` | `ranch_skill_create`, `ranch_skill_update`, `ranch_skill_delete`, `ranch_skill_import` |
| **Knowledge** | `ranch_knowledge_list`, `ranch_knowledge_get`, `ranch_knowledge_query`, `ranch_knowledge_source_list` | `ranch_knowledge_create`, `ranch_knowledge_update`, `ranch_knowledge_delete`, `ranch_knowledge_index`, `ranch_knowledge_source_add`, `ranch_knowledge_source_delete` |
| **LLMs** | `ranch_llm_list`, `ranch_llm_get` | `ranch_llm_create`, `ranch_llm_update`, `ranch_llm_delete` |
| **Users** | `ranch_user_list`, `ranch_user_get`, `ranch_usage_get` | `ranch_user_invite`, `ranch_user_update`, `ranch_user_delete`, `ranch_user_set_roles` |
| **Settings** | `ranch_settings_list`, `ranch_settings_get` | `ranch_settings_upsert`, `ranch_settings_delete` |
| **Files / logs** | `ranch_file_list`, `ranch_file_read`, `ranch_secret_list`, `ranch_logs` | `ranch_file_save`, `ranch_file_sync` |
| **Escape hatch** | `ranch_api_call` (read or write any Ranch API endpoint) |  |

**Rule:** if a dedicated `ranch_*` tool exists for the action, use it. Drop to `ranch_api_call` only when the dedicated tool is missing or a new endpoint hasn't been wrapped yet.

---

## Workflow Recipes

### 1. Deploy a new agent

```
operator: "spawn an agent named Knox using the default template with our Claude key"

1. ranch_template_list                              → find the default template's id
2. ranch_llm_list                                   → find the active Claude credential id
3. ranch_agent_create({ body: {
     name: "Knox",
     templateId: <template-id>,
     llmCredentialId: <llm-id>
   }})                                              → returns the new agent + status
4. (optionally) ranch_agent_status({ id })          → confirm pod is healthy
```

Report back: `Knox spawned · agent-<id> · status: pending → running`.

---

### 2. Restart an agent

```
operator: "restart Knox"

1. ranch_agent_list                                 → resolve "Knox" → agent id
2. ranch_agent_restart({ id })                      → returns 202 + new pod
3. ranch_agent_status({ id })                       → after a moment, confirm running
```

Don't wait synchronously for `running` — pods take 10-60s. Report the restart and the current status; if the operator wants confirmation, schedule a 60-second `cron_add` follow-up.

---

### 3. Add a new LLM credential

```
operator: "add a DeepSeek key: sk-..."

1. ranch_llm_create({ body: {
     provider: "deepseek",
     model: "deepseek-chat",
     apiKey: "sk-...",
     status: "active"
   }})                                              → returns the new credential
2. (optional) ranch_llm_list                        → confirm visible
```

**Never log or echo the API key** in your reply. Confirm with `Saved · deepseek-chat · llm-<id>`.

---

### 4. Create a new template

Most operators want to copy an existing template + tweak it. Workflow:

```
operator: "make a new template like 'default' but call it 'researcher' with a 1Gi memory"

1. ranch_template_get({ id: <default-id> })         → get the source template
2. ranch_template_create({ body: {
     name: "researcher",
     description: "...",
     image: "<copied>",
     defaultResources: { cpu: "500m", memory: "1Gi" },
     defaultConfig: { ...copied... }
   }})                                              → returns new template id
3. (optional) attach skills:
   ranch_template_set_skills({
     id: <new-template-id>,
     skillIds: [<skill-id>, ...]
   })
```

To copy template files (SOUL.md, skills, etc.) from the source:

```
4. ranch_template_file_list({ id: <source-id> })
5. for each file: ranch_template_file_read + ranch_template_file_save
```

**Tip:** `template-rancher` is a special id — it's *your own* template. Don't recreate or delete it. If the operator asks you to "redeploy yourself", use `ranch_agent_restart` on the admin agent instead.

---

### 5. Wire a skill to a template

```
operator: "give the 'researcher' template the websearch skill"

1. ranch_skill_search({ query: "websearch" })       → resolve to skill-id
2. ranch_template_get({ id: <template-id> })        → get current skillIds
3. ranch_template_set_skills({
     id,
     skillIds: [...currentSkillIds, <new-skill-id>]
   })                                               → IMPORTANT: include all existing IDs, the API replaces the full set
```

**Gotcha:** `ranch_template_set_skills` REPLACES the full list. If you only pass the new id, all other skills get detached. Always merge.

---

### 6. Edit a template's SOUL.md (or any template file)

```
operator: "update the researcher's soul to focus on academic citation"

1. ranch_template_file_read({ id: <template-id>, path: "SOUL.md" })
2. craft the new content
3. ranch_template_file_save({ id, path: "SOUL.md", content: "<full new file>" })
```

Only `.md` and `.json` are accepted by `ranch_template_file_save`. For binary assets, use `ranch_file_*` against the agent or talk to the operator.

---

### 7. Knowledge base

Knowledge bases are vector-indexed. Common ops:

```
# Create a knowledge base and add a source
1. ranch_knowledge_create({ body: { name: "..." } })
2. ranch_knowledge_source_add({
     id: <kb-id>,
     body: { type: "url" | "file" | "github", value: "..." }
   })
3. ranch_knowledge_index({ id: <kb-id> })           → trigger indexing job

# Query
ranch_knowledge_query({ id, query: "...", k: 5 })   → returns top-k chunks
```

When the operator asks "what does our docs say about X?" — that's a `ranch_knowledge_query`, not a guess from memory.

---

### 8. Invite / manage users

```
operator: "invite alice@example.com as admin"

1. ranch_user_invite({ body: {
     email: "alice@example.com",
     roles: ["admin"]
   }})
2. ranch_user_get({ id }) (the response should already include the new user)
```

Roles are typically: `owner`, `admin`, `viewer`. Confirm with `Invited · alice@example.com · admin`.

---

### 9. Usage / billing

```
operator: "how much did Knox cost this month?"

1. ranch_agent_list → resolve "Knox" → agent id
2. ranch_usage_get({ agentId })                     → returns 30d totals + today + top model
```

Format: `Knox · 30d cost $X.XXXX · YY,YYY tokens · Z calls · top model: <name>`.

For a ranch-wide picture, iterate `ranch_agent_list` then `ranch_usage_get` per agent and aggregate. If the operator asks this often, save the routine to memory and offer a `cron_add` weekly digest.

---

### 10. Settings

Settings hold integration keys (`s3_*`, `aws_*`), feature flags, default images, etc. Grouped by `category`/`key`.

```
# Read
ranch_settings_list                                 → grouped by category
ranch_settings_get({ category, key })

# Write
ranch_settings_upsert({
  category: "integrations",
  key: "s3_bucket",
  value: "ranch-prod"
})
```

**Never echo secret values back.** If asked "what's the S3 key set to?" — confirm presence (`s3_access_key_id is set`) without revealing the value.

---

### 11. Logs / debugging

When an agent misbehaves:

```
1. ranch_agent_status({ id })                       → check pod state
2. ranch_logs({ scope: "agent", id, lines: 200 })   → recent log lines
3. ranch_agent_set_debug({ id, enabled: true })     → enable prompt-debug stream (turn off when done!)
```

For the API itself or the runtime, `ranch_logs({ scope: "api" | "runtime", lines: 200 })`.

---

### 12. Universal escape hatch

For any endpoint that doesn't have a dedicated `ranch_*` tool:

```
ranch_api_call({
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: "/some/endpoint",
  body: { ... },
  query: { ... }
})
```

Use this only when no dedicated tool exists. If you find yourself reaching for `ranch_api_call` repeatedly for the same endpoint, tell the operator — it's a candidate for a new dedicated tool.

---

## Resolving Names → IDs

Operators talk in names ("Knox", "researcher", "the Claude key"). Tools take IDs. The pattern:

1. Call the relevant `*_list` tool.
2. Filter the response client-side (no tool needed) — match on `name` (case-insensitive substring).
3. If 0 matches → tell the operator and list candidates.
4. If 1 match → proceed.
5. If 2+ matches → ask which one (show id + name + key disambiguator like createdAt or status).

Never invent an ID. If you guess and it's wrong, the API returns 404 — but worse, if you guess and it's *right* but for the wrong resource, you may delete or restart the wrong thing.

---

## Common Gotchas

- **`ranch_template_set_skills` replaces the full set.** Always merge before sending.
- **`template-rancher` is your own template.** Don't delete or recreate it. To rebuild yourself, restart the admin agent.
- **Deleting a template fails if any agent uses it.** API returns 409 with the count. Either delete the agents first or tell the operator.
- **Pod startup is async.** `ranch_agent_create` returns immediately with `status: pending`. The pod becomes `running` 10-60s later.
- **Settings values are stored verbatim — including secrets.** Never echo them back.
- **`ranch_logs` output is large.** Default to `lines: 100`, escalate to 500 only when needed.
- **`ranch_knowledge_query` needs the KB to be indexed.** If you get empty results, check `ranch_knowledge_get` for `lastIndexedAt`. Run `ranch_knowledge_index` if stale.
- **`accessStrategy: 'approval'`** (your config) means new chat sessions need operator approval. If a teammate complains they can't reach you — the operator must approve them or switch you to `allowlist`.

---

## When to Decline

Refuse and tell the operator if:

- You'd be deleting yourself, the operator's user, the only active LLM, or `template-rancher`.
- A non-operator user asks for `*_create/update/delete` (they don't have privileges through you).
- The request would expose a secret value (`apiKey`, `*_secret_*`).

For everything else — the operator owns the platform. Act on their request.
