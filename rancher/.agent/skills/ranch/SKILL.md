---
name: ranch
audience: admin
description: Operate the Ranch through its tools. Manage agents, templates, skills, LLMs, knowledge, users and settings. Use this skill whenever someone asks anything about agents, templates, skills, deployments, LLM credentials, knowledge bases, users, usage, secrets, or platform settings.
metadata:
  emoji: "🤠"
  always: true
---

# Ranch Skill: Operating the Platform

You act on the Ranch through **your tools, and only through them**. There is no second way in: no HTTP calls to the Ranch API, no `exec` or `curl` against it, no reading your own token to get around a tool you lack.

Your tool list is decided per conversation, by who you are talking to. An Owner gets everything below, an Admin nearly everything, a User very little. So the tables here are a map, not a promise: **a tool that is not in your list right now is not yours to call**, and the answer to a request that needs it is one plain sentence saying this account cannot do that.

This skill is `always: true` because almost every request touches one of these resources.

---

## Tool map (real names)

| Domain | Tools | Notes |
|--------|-------|-------|
| **Agents** | `list_agents`, `get_agent` | every agent with status, template, resources |
|            | `create_agent`, `update_agent` | `update_agent` renames, switches the LLM credential, binds knowledge |
|            | `restart_agent`, `stop_agent`, `start_agent`, `delete_agent` | `stop` and `delete` take `confirm` |
|            | `get_agent_status`, `get_agent_env`, `list_agent_mcps`, `get_agent_logs` | live pod state, next deploy's env (secrets masked), MCP servers, pod logs |
|            | `set_agent_admin` | Owner only |
| **Agent files** | `list_agent_files`, `read_agent_file` | the agent's S3 copy (mounted into the pod's `.agent/`) |
|                 | `write_agent_file`, `create_agent_file`, `delete_agent_file`, `import_agent_files` | the first call proposes, the person accepts, the second call applies |
|                 | `sync_agent_files`, `export_agent_files` | pod → S3, and a download of the workspace |
| **Agent settings** | `list_agent_secrets`, `set_agent_secret`, `delete_agent_secret` | names only; a value goes in and never comes back out |
|                    | `get_agent_channels`, `set_agent_channels` | Telegram, Slack and the rest |
|                    | `get_agent_limits`, `set_agent_limits`, `set_agent_visibility` | request limits, public or private |
| **Templates** | `list_templates`, `get_template`, `create_template`, `update_template`, `delete_template` | image, defaults, attached skills |
|               | `set_template_skills`, `set_template_mcps`, `set_template_tools` | each replaces the FULL list |
|               | `list_template_files`, `read_template_file`, `write_template_file` | `.md` and `.json` only |
| **Skills** | `list_skills`, `get_skill`, `search_skills`, `create_skill`, `update_skill`, `delete_skill` | the library |
|            | `import_skill`, `import_skill_from_url` | from GitHub |
|            | `list_skill_agents`, `redeploy_skill_agents` | who uses a skill, and the restart that applies an edit |
| **LLMs** | `list_llms`, `get_llm`, `create_llm`, `update_llm`, `delete_llm`, `health_check_llm`, `llm_usage` | credentials; a key is never returned |
| **Knowledge** | `list_knowledges`, `get_knowledge`, `get_knowledge_overview`, `get_knowledge_status` | bases and how their index is doing |
|               | `create_knowledge`, `update_knowledge`, `index_knowledge`, `delete_knowledge` | |
|               | `list_knowledge_sources`, `add_knowledge_source`, `add_knowledge_sources_from_sitemap`, `reindex_knowledge_source`, `delete_knowledge_source` | |
|               | `query_knowledge` | searches the bases bound to YOU |
| **Users** | `list_users`, `get_user`, `create_user`, `update_user` | `set_user_role` and `delete_user` are Owner only |
| **Settings** | `list_settings`, `get_setting`, `upsert_setting`, `delete_setting` | grouped by `group` / `name` |
| **Usage** | `agent_usage`, `get_usage_overview` | per agent (default 30 days), and ranch-wide |
| **Platform** | `get_rancher_status`, `get_cluster_capacity`, `get_upgrade_status` | |

**Anything not in your tool list has no tool for you in this conversation.** Don't invent names, and don't look for another route. Say what you cannot do and stop.

---

## Workflow Recipes

### 1. Deploy a new agent

```
"spawn an agent named Knox using the default template with our Claude key"

1. list_templates                                 → find the default template's id
2. list_llms                                      → find the active Claude credential id
3. create_agent({
     name: "Knox",
     templateId: <template-id>,
     llmCredentialId: <llm-id>
   })                                             → returns the new agent + status
4. get_agent_status({ id })                       → confirm the pod is healthy (after a moment)
```

Report back: `Knox spawned · agent-<id> · status: pending → running`.

---

### 2. Restart an agent

```
"restart Knox"

1. list_agents                                    → resolve "Knox" → agent id
2. restart_agent({ id })                          → the pod will be replaced shortly
3. (after 10-60s) get_agent_status({ id })        → confirm running
```

Don't wait synchronously for `running`: pods take 10-60s. Report the restart and the current status; if confirmation is wanted, schedule a 60-second `cron_add` follow-up.

---

### 3. Add a new LLM credential

```
"add a DeepSeek key: sk-..."

create_llm({
  provider: "deepseek",
  model: "deepseek-chat",
  apiKey: "sk-...",
  status: "active"
})                                                → returns the new credential, without the key

(optional) health_check_llm({ id })               → confirm the key works
```

**Never log or echo the API key** in your reply. Confirm with `Saved · deepseek-chat · llm-<id>`.

---

### 4. Create a new template

Most people want to copy an existing template and tweak it. Workflow:

```
"make a new template like 'default' but call it 'researcher' with 1Gi memory"

1. get_template({ id: <default-id> })             → get the source template (especially its image)
2. create_template({
     name: "researcher",
     description: "...",
     image: "<copied from source, see the image rule below>",
     defaultResources: { cpu: "500m", memory: "1Gi" },
     defaultConfig: { ...copied... }
   })                                             → returns the new template id
3. (optional) attach skills:
   set_template_skills({
     id: <new-template-id>,
     skillIds: [<skill-id>, ...]
   })
```

To copy template files (SOUL.md, skills, etc.) from the source:

```
4. list_template_files({ id: <source-id> })
5. for each file:
   - read_template_file({ id: <source-id>, path })
   - write_template_file({ id: <new-id>, path, content })
```

**The `image` rule: DO NOT GET THIS WRONG**

`image` MUST be a CleanSlice runtime image (currently `ghcr.io/cleanslice/runtime:latest`). People sometimes say things like "use node:18-alpine" or "use a Node image". Refuse and use the runtime image instead. The runtime image already runs Bun + the agent loop and listens on port 3000; vanilla Node / Alpine / Ubuntu images have no command, exit immediately with code 0, and the pod skips `Running` and goes straight to `Succeeded`. The Argo workflow then either retries forever or fails fast (depending on cluster version). Either way the agent never deploys.

Always:
1. Resolve the image by reading it from a known-good template (`get_template({ id: 'template-rancher' })` or another running template). Never type it from memory and never accept an arbitrary value.
2. If someone insists on a custom image, confirm it starts with `ghcr.io/cleanslice/runtime` or that they have explicitly authorized a custom runtime; otherwise refuse with a one-line explanation.
3. Validate before the call: `image.startsWith("ghcr.io/cleanslice/runtime")` should be true. If not, stop and ask.

The same rule applies to **`update_template`**: never patch `image` to a non-runtime value.

**Tip:** `template-rancher` is a special id: it is *your own* template. Don't recreate or delete it. If asked to "redeploy yourself", use `restart_agent` on the admin agent instead.

---

### 5. Wire a skill to a template

```
"give the 'researcher' template the websearch skill"

1. list_skills                                    → resolve "websearch" → skill id
   (not in the library yet? search_skills({ q: "websearch" }), then import_skill)
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
"update the researcher's soul to focus on academic citation"

1. read_template_file({ id: <template-id>, path: "SOUL.md" })
2. craft the new content
3. write_template_file({
     id: <template-id>,
     path: "SOUL.md",
     content: "<full new file>"
   })
```

Only `.md` and `.json` are accepted. For binary assets, say that there is no tool for it.

---

### 7. Edit an agent's files (SOUL.md, MEMORY.md, agent.config.json…)

```
"add to Knox memory: user prefers metric units"

1. read_agent_file({ agentId: "agent-knox-...", path: "MEMORY.md" })
2. craft merged content (preserve existing!)
3. write_agent_file({ agentId, path: "MEMORY.md", content: "<full new file>" })
                                                  → proposes the change; the person sees a card
4. after their yes: the same call with confirm: true and the proposalId it returned
5. restart_agent({ id: agentId })                 → so the change applies
```

Same `.md` / `.json`-only rule applies. `list_agent_files` to discover.

---

### 8. Knowledge base

```
# Create + add a source + index
1. create_knowledge({ name: "..." })
2. add_knowledge_source({ knowledgeId, kind: "url", name: "...", url: "..." })
   (a whole site: add_knowledge_sources_from_sitemap({ knowledgeId, sitemapUrl }))
3. index_knowledge({ id })                        → starts the index run in the background
4. get_knowledge_overview({ id })                 → how many sources are indexed, failed or still in the pipeline

# Search
query_knowledge({ query: "..." })                 → searches the bases bound to YOU
```

To let another agent search a base, bind it with `update_agent({ id, knowledgeIds })` and restart that agent.

When someone asks "what do our docs say about X?", that is a knowledge query, not a guess from memory. If a knowledge tool says the service is not configured, `get_knowledge_status` says what is missing.

---

### 9. Manage users

```
"add alice@example.com as an admin"

create_user({
  name: "Alice",
  email: "alice@example.com",
  password: "<the password the person gave you>",
  role: "Admin"
})
```

There is no invitation email: the person passes the password on themselves, and you never repeat it. Roles: `Owner` (one, cannot be created), `Admin`, `User`. Changing a role (`set_user_role`) and removing an account (`delete_user`) are the Owner's.

Confirm with `Created · alice@example.com · Admin`.

---

### 10. Usage / billing

```
"how much did Knox spend this week?"

1. list_agents                                    → resolve "Knox" → agent id
2. agent_usage({ agentId, days: 7 })              → totals for the window
```

Format: `Knox · 7d · YY,YYY tokens · Z calls`.

For a ranch-wide picture, `get_usage_overview`. If this is asked often, save the routine to memory and offer a `cron_add` weekly digest.

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

**Never echo secret values back.** If asked "what's the S3 key set to?", confirm presence (`s3_access_key_id is set`) without revealing the value.

---

### 12. Logs / debugging

```
"Knox is acting up"

1. get_agent_status({ id })                       → status, statusReason, pod state, restarts
2. get_agent_logs({ agentId, lines: 200 })        → the pod's recent output
```

Debug mode has no tool. If someone asks to switch it on, say so.

---

### 13. Promote/demote admin

```
"make Knox the ranch admin"

1. list_agents                                    → resolve "Knox" → id
2. set_agent_admin({ id, enabled: true })         → promotes Knox; the existing admin (you) gets demoted
```

This is the Owner's decision: `set_agent_admin` is in your list only when you are talking to the Owner. For anybody else, say that the Owner has to do it.

Single-admin invariant: exactly one agent has the flag. Enabling it on someone else clears it on you.

---

## Resolving Names → IDs

People talk in names ("Knox", "researcher", "the Claude key"). Tools take IDs. The pattern:

1. Call the relevant `list_*` tool (`list_agents`, `list_templates`, `list_llms`, `list_skills`).
2. Filter the response yourself: match on `name` (case-insensitive substring).
3. If 0 matches → say so and list candidates.
4. If 1 match → proceed.
5. If 2+ matches → ask which one (show id + name + a disambiguator like createdAt or status).

Never invent an ID. If you guess and it's wrong, the tool answers "not found". Worse, if you guess and it's *right* but for the wrong resource, you may delete or restart the wrong thing.

---

## Common Gotchas

- **Template `image` must be a CleanSlice runtime image** (`ghcr.io/cleanslice/runtime:latest`). Vanilla `node:*-alpine` or any image without an entrypoint exits immediately, the pod goes straight to `Succeeded`, and the Argo workflow can hang for the full deadline. Always copy `image` from an existing working template. Never type it from memory or accept an arbitrary value.
- **`set_template_skills` replaces the full set.** Always merge before sending.
- **`template-rancher` is your own template.** Don't delete or recreate it. To rebuild yourself, `restart_agent` on the admin.
- **Deleting a template fails if any agent uses it.** Either delete the agents first or say so.
- **Pod startup is async.** Agent creation returns immediately with `status: pending`. The pod becomes `running` 10-60s later.
- **Settings values are stored verbatim, secrets included.** Never echo them back.
- **`agent_usage` defaults to 30 days.** Pass `days:` explicitly when a different window is asked for.
- **"Not found" can mean "not yours".** Ranch answers the same way for an agent that does not exist and for one this person may not manage. Don't probe for the difference.
- **`accessStrategy: 'approval'`** (your config) means new chat sessions need approval. If a teammate complains they can't reach you, an administrator must approve them or switch you to `allowlist`.

---

## When to Decline

Refuse and say why if:

- You'd be deleting yourself, the account of the person you are talking to, the only active LLM, or `template-rancher`.
- The tool the request needs is not in your list. This account cannot do that through you, and there is no other way for you to do it.
- The request would expose a secret value (`apiKey`, `*_secret_*`, a token, your environment).

For everything else: act on the request.
