# Contract: the tool inventory

The complete list of tools after CLEAN-109. **Existing** tools keep their name and behaviour and only gain metadata. **New** tools are the audit's Gap column made concrete. "Backing" names the domain service/gateway the tool calls — the same one the console's controller uses (spec FR-008). Audience: **O** operator only, **A** agent self-service (any runtime), **E** everyone. ⚠ = destructive (requires `confirm`).

Templates are indicative; the implementer may improve wording but keeps the placeholder convention.

## agents — Agents

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_agents | existing | O | List agents | List all agents and their status | IAgentGateway |
| get_agent | existing | O | Show an agent | Show the agent «name» | IAgentGateway |
| create_agent | existing | O | Create an agent | Create an agent «name» from template «template» using the LLM credential «credential» | AgentDeployService |
| update_agent | existing | O | Update an agent | Change the agent «name»: «what to change» | IAgentGateway + AgentDeployService |
| set_agent_admin | existing | O | Make an agent the Ranch admin | Make «name» the Ranch admin agent | IAgentGateway/AgentDeployService |
| restart_agent | existing | O | Restart an agent | Restart the agent «name» | AgentDeployService |
| stop_agent | new | O ⚠ | Stop an agent | Stop the agent «name» | AgentDeployService (as `POST :id/stop`) |
| start_agent | new | O | Start an agent | Start the agent «name» | AgentDeployService (as `POST :id/start`) |
| delete_agent | new | O ⚠ | Delete an agent | Delete the agent «name» and its workspace | AgentDeployService + IAgentGateway (`DELETE :id`, `wipeS3` option) |
| get_agent_status | new | O | Show live status and metrics | How is the agent «name» doing right now? | AgentStatusService + IPodGateway (`:id/metrics`, `status`) |
| get_agent_env | new | O | Show the pod environment preview | Show the environment the agent «name» runs with | as `GET :id/env` (values of secrets masked as the console masks them) |
| get_agent_logs | new | O | Read pod logs | Show the last «100» log lines of the agent «name» | LogController's gateway (`GET agents/:id/logs`, tail param) |
| list_agent_mcps | new | O | Show the agent's MCP servers | Which MCP servers does the agent «name» have, and does it need a restart? | AgentMcpResolver + detectMcpConfigDrift (no authValue in result) |
| get_cluster_capacity | new | O | Show cluster capacity | How much capacity is left for new agents? | as `GET agents/capacity` |

## agent_workspace — Agent workspace

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_agent_files | existing | O | List workspace files | List the files of the agent «name» | IFileGateway |
| read_agent_file | existing | O | Read a workspace file | Show «path» from the agent «name» | IFileGateway |
| write_agent_file | existing | O | Write a workspace file | Write «path» in the agent «name» with: «content» | IFileGateway |
| delete_agent_file | new | O ⚠ | Delete a workspace file | Delete «path» from the agent «name» | IFileGateway (`DELETE files/content`) |
| sync_agent_files | new | O | Sync files from the pod | Sync the workspace files of the agent «name» from its pod | SyncGuardService + IFileGateway (`POST files/sync`) |
| export_agent_files | new | O | Export the workspace | Export the workspace of the agent «name» | returns the console download path (`GET files/export`) |
| list_agent_secrets | new | O | List secret names | Which secrets does the agent «name» have? | ISecretGateway (names only) |
| set_agent_secret | new | O | Set a secret | Set the secret «KEY» of the agent «name» to «value» | ISecretGateway (`PUT`) |
| delete_agent_secret | new | O ⚠ | Delete a secret | Delete the secret «KEY» of the agent «name» | ISecretGateway (`DELETE`) |
| replace_agent_secrets | new | O ⚠ | Replace all secrets | Replace all secrets of the agent «name» with: «KEY=value, …» | ISecretGateway (`POST replace`) |
| get_agent_channels | new | O | Show delivery channels | Which channels is the agent «name» connected to? | IAgentChannelGateway |
| set_agent_channels | new | O | Set delivery channels | Connect the agent «name» to «channel list» | IAgentChannelGateway (`PUT :id/channels`) |
| get_share_link | new | O | Show the share link | Does the agent «name» have a public share link? | ShareLinkService |
| create_share_link | new | O | Create a share link | Create a public share link for the agent «name» | ShareLinkService |
| regenerate_share_link | new | O ⚠ | Regenerate the share link | Regenerate the share link of the agent «name» | ShareLinkService |
| revoke_share_link | new | O ⚠ | Revoke the share link | Revoke the share link of the agent «name» | ShareLinkService |

## templates — Templates

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_templates | existing | O | List templates | List all agent templates | ITemplateGateway |
| get_template | existing | O | Show a template | Show the template «name» | ITemplateGateway |
| update_template | existing | O | Update a template | Change the template «name»: «what to change» | ITemplateGateway |
| set_template_skills | existing | O | Set template skills | Give the template «name» the skills «skill list» | ITemplateGateway |
| list_template_files | existing | O | List template files | List the files of the template «name» | ITemplateFileGateway |
| read_template_file | existing | O | Read a template file | Show «path» of the template «name» | ITemplateFileGateway |
| write_template_file | existing | O | Write a template file | Write «path» in the template «name» with: «content» | ITemplateFileGateway |
| create_template | new | O | Create a template | Create a template «name» with image «image» described as «description» | ITemplateGateway |
| delete_template | new | O ⚠ | Delete a template | Delete the template «name» | ITemplateGateway |
| set_template_mcps | new | O | Attach MCP servers to a template | Attach the MCP servers «server list» to the template «name» | ITemplateGateway (`PUT :id/mcps`) |
| restart_template_agents | new | O ⚠ | Restart every agent of a template | Restart all agents of the template «name» | AgentDeployService (`POST restart-by-template/:templateId`) |
| preview_template_install_from_git | new | O | Preview a git template | What would installing the template from «git url» at «ref» bring? | TemplateInstallService |
| install_template_from_git | new | O | Install a template from git | Install the template from «git url» at «ref» | TemplateInstallService |
| export_template | new | O | Export a template | Export the template «name» | TemplateExportService → download path |

Zip install and binary file upload stay console-only (spec Assumptions); `install_template_from_git` covers the same source without a browser.

## skills — Skills

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_skills | existing | O | List skills | List all skills | ISkillGateway |
| update_skill | existing | O | Update a skill | Change the skill «name»: «what to change» | ISkillGateway |
| list_skill_agents | existing | O | Which agents use a skill | Which agents use the skill «name»? | ISkillGateway |
| redeploy_skill_agents | existing | O ⚠ | Redeploy agents of a skill | Redeploy every agent that uses the skill «name» | AgentDeployService |
| get_skill | new | O | Show a skill | Show the skill «name» | ISkillGateway |
| create_skill | new | O | Create a skill | Create a skill «title» that «what it does» | ISkillGateway |
| delete_skill | new | O ⚠ | Delete a skill | Delete the skill «name» | ISkillGateway |
| import_skill_from_url | new | O | Import a skill from GitHub | Import the skill at «github url» | SkillController import-url path (GithubSearch + gateway) |
| search_skills | new | O | Search public skills | Find public skills about «topic» | GithubSearch |
| import_skill | new | O | Import a found skill | Import the skill «name» from «repo» | as `POST skills/import` |

## llm — LLM credentials

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_llms | existing | O | List LLM credentials | List the LLM credentials | ILlmGateway (keys stripped) |
| get_llm | new | O | Show a credential | Show the LLM credential «name» | ILlmGateway (key stripped) |
| create_llm | new | O | Create a credential | Create an LLM credential «name» for «provider» with key «key» | ILlmGateway |
| update_llm | new | O | Update a credential | Change the LLM credential «name»: «what to change» | ILlmGateway |
| delete_llm | new | O ⚠ | Delete a credential | Delete the LLM credential «name» | ILlmGateway |
| health_check_llm | new | O | Health-check a credential | Check that the LLM credential «name» works | ILlmHealthGateway |
| list_llm_models | new | O | List known models | Which models can I use with «provider»? | as `GET llms/models` (llm slice providers catalogue) |
| llm_usage | new | O | Usage of a credential | How much did the credential «name» cost in the last 30 days? | UsageController path (`GET llms/:id/usage`) |

## mcp_servers — MCP servers

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_mcp_servers | new | O | List MCP servers | List the MCP servers registered in this Ranch | IMcpServerGateway (authValue stripped) |
| get_mcp_server | new | O | Show an MCP server | Show the MCP server «name» | IMcpServerGateway |
| register_mcp_server | new | O | Register an MCP server | Register the MCP server at «url» named «name» with «bearer|none» auth | IMcpServerGateway |
| update_mcp_server | new | O | Update or enable/disable a server | Disable the MCP server «name» | IMcpServerGateway (built-in rows: enabled/description only, as the controller enforces) |
| delete_mcp_server | new | O ⚠ | Delete an MCP server | Delete the MCP server «name» | IMcpServerGateway (built-ins refused with the controller's message) |
| start_mcp_oauth | new | O | Start OAuth for a server | Connect the MCP server «name» with OAuth | McpOauthService → returns the URL the person must open; optional `subject` keys the token to one person (CLEAN-80), otherwise the agent-wide bundle |
| probe_mcp_server | new (CLEAN-78) | O | Check what an MCP server offers | Check what the MCP server at «url» offers | McpProbeService → transport, authType, OAuth capabilities, tools/list; pasted urls pass the A2A public-address guard, registered rows (by id) skip it; never returns a credential |

## knowledge — Knowledge

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| query_knowledge | existing | A/E | Ask the knowledge bases | What does our knowledge say about «question»? | KnowledgeService |
| list_knowledges | new | O | List knowledge bases | List the knowledge bases | KnowledgeService |
| get_knowledge | new | O | Show a knowledge base | Show the knowledge base «name» | KnowledgeService |
| create_knowledge | new | O | Create a knowledge base | Create a knowledge base «name» described as «description» | KnowledgeService |
| update_knowledge | new | O | Update a knowledge base | Change the knowledge base «name»: «what to change» | KnowledgeService |
| delete_knowledge | new | O ⚠ | Delete a knowledge base | Delete the knowledge base «name» | KnowledgeService |
| index_knowledge | new | O | Start indexing | Index the knowledge base «name» | KnowledgeService |
| get_knowledge_overview | new | O | Source counts and size | How big is the knowledge base «name» and what is in it? | KnowledgeService (`:id/overview`) |
| list_knowledge_graph_labels | new | O | Entity labels | Which entity labels does the knowledge base «name» have? | ILightragClient (`:id/graph/labels`) |
| get_knowledge_status | new | O | Knowledge service status | Is the knowledge service ready? | IKnowledgeConfigGateway + ILightragClient (`status`) |
| list_knowledge_sources | new | O | List sources | List the sources of the knowledge base «name» | SourceService |
| add_knowledge_source | new | O | Add a URL or text source | Add «url or text» to the knowledge base «name» | SourceService (`POST`, kind url/text) |
| add_knowledge_sources_from_sitemap | new | O | Add URLs from a sitemap | Add every page of «sitemap url» to the knowledge base «name» | SourceService (`from-sitemap`) |
| reindex_knowledge_source | new | O | Retry one source | Reindex the source «name» in the knowledge base «base» | SourceService |
| extract_knowledge_source | new | O | Re-extract a scanned PDF | Re-run text extraction for «source» in «base» | SourceService |
| delete_knowledge_source | new | O ⚠ | Delete a source | Delete the source «name» from the knowledge base «base» | SourceService |
| list_knowledge_imports | new | O | Imports in progress | Are any imports running for the knowledge base «name»? | SourceService (`imports`) |

File and archive uploads from a person's machine stay console-only; `add_knowledge_source` covers text the agent can produce and URLs.

## settings — Settings

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| list_settings | existing (+dynamic description) | O | List settings | Show the settings in «group» | ISettingGateway + SETTING_CATALOG |
| upsert_setting | existing (+dynamic description) | O | Set a setting | Set «group».«name» to «value» | ISettingGateway |
| get_setting | new | O | Show one setting | What is «group».«name» set to? | ISettingGateway |
| delete_setting | new | O ⚠ | Delete a setting | Reset «group».«name» to its default | ISettingGateway |

## peers — Peers (A2A)

All 15 existing tools (`list_agent_peers`, `list_peer_candidates`, `preview_agent_card`, `list_agent_delegations`, `connect_agent_peer`, `import_external_agent`, `refresh_agent_peer`, `remove_agent_peer` — O; `list_my_peers`, `list_ranch_agents`, `preview_agent_card_by_address`, `connect_my_peer`, `import_my_peer_by_address`, `remove_my_peer` — A; `ask_agent` — A) gain metadata only. `remove_agent_peer` and `remove_my_peer` become ⚠.

## paddock — Paddock

Existing 12 (`list_paddock_scenarios`, `get_paddock_scenario`, `list_agent_paddock_scenarios`, `create_paddock_scenario`, `update_paddock_scenario`, `delete_paddock_scenario` ⚠, `run_paddock_evaluation`, `list_paddock_evaluations`, `get_paddock_evaluation`, `get_paddock_evaluation_report`, `abort_paddock_evaluation` ⚠, `rerun_paddock_evaluation`) gain metadata. New:

| name | aud | title | template | backing |
|---|---|---|---|---|
| generate_paddock_scenarios | O | Generate scenarios from a description | Generate «3» paddock scenarios for the agent «name» about «topic» | IPaddockScenarioGeneratorGateway |
| get_paddock_evaluation_logs | O | Evaluation logs | Show the logs of evaluation «id» | PaddockEvaluationService |
| get_paddock_evaluation_scenario_result | O | One scenario's result | How did scenario «scenario» go in evaluation «id»? | PaddockEvaluationService |
| get_paddock_evaluation_trace | O | Evaluation trace | Show the trace of evaluation «id» | PaddockEvaluationService |

## users_keys — Users & API keys

| name | aud | title | template | backing |
|---|---|---|---|---|
| list_users | O | List users | List the users of this Ranch | IUserGateway (no password hashes) |
| get_user | O | Show a user | Show the user «email» | IUserGateway |
| create_user | O | Create a user | Create a user «name» with email «email» and password «password» | IUserGateway |
| update_user | O | Update a user | Change the user «email»: «what to change» | IUserGateway |
| set_user_role | O ⚠ | Set a user's role | Make «email» an «admin|owner|user» | IUserGateway (`PUT :id/role`, Owner only as the controller) |
| delete_user | O ⚠ | Remove a user | Remove the user «email» | IUserGateway |
| list_api_keys | O | List API keys | List the API keys | IApiKeyGateway (prefix/metadata only) |
| create_api_key | O | Create an API key | Create an API key named «name» | ApiKeyService (returns the key once — research R6) |
| revoke_api_key | O ⚠ | Revoke an API key | Revoke the API key «name» | IApiKeyGateway |

## chats_usage — Chats & usage

| name | status | aud | title | template | backing |
|---|---|---|---|---|---|
| agent_usage | existing | O | Usage of an agent | How much did the agent «name» cost in the last «30» days? | IUsageGateway |
| list_chats | new | O | List chats | List the recent chats «of agent name» | IChatGateway |
| get_chat | new | O | Show a chat | Show the chat «id» | IChatGateway |
| get_chat_messages | new | O | Read chat messages | Show the last «20» messages of chat «id» | TranscriptReaderService |
| sync_chats | new | O | Sync chats from runtimes | Sync chats «of agent name» from their runtimes | ChatSyncService |
| summarize_chat | new | O | Summarize a chat | Summarize the chat «id» | ChatInsightService |
| export_chat | new | O | Export a chat | Export the chat «id» | download path (`GET chats/:id/export`) |
| get_usage_overview | new | O | Usage across all agents | How much did all agents cost in the last 30 days? | IUsageGateway (`usage/overview`) |

## browser — Browser & integrations

Existing 6 `browser_session_*` (A, userId must match caller) gain metadata; `browser_session_close` and `browser_session_reset` become ⚠. New (same userId convention as the browser tools):

| name | aud | title | template | backing |
|---|---|---|---|---|
| list_integration_catalogue | A | Available integrations | Which integrations can I connect? | IntegrationService |
| list_integration_accounts | A | My integration accounts | Which integration accounts do I have? | IntegrationService (secrets stripped) |
| create_integration_account | A | Connect an integration account | Connect my «service» account «label» | IntegrationService |
| request_integration_login | A | Ask for a login | Ask me to log in to «service» | IntegrationService (`accounts/:id/login`) |
| delete_integration_account | A ⚠ | Disconnect an account | Disconnect my «service» account | IntegrationService |

## attachments — Attachments

`query_attachment` (existing, E) gains metadata: title "Ask a question about an attached file", template "In the attached file, «question»".

## platform — Platform

| name | aud | title | template | backing |
|---|---|---|---|---|
| get_upgrade_status | O | Ranch upgrade status | Is a Ranch upgrade available? | UpgradeService |
| run_upgrade | O ⚠ | Upgrade Ranch | Upgrade Ranch to the latest version | UpgradeService |
| get_rancher_status | O | Rancher setup status | Is the Rancher setup complete? | RancherService |

## Totals

Existing tools annotated: 59. New tools: 93. Destructive (⚠): 30. Topics: 15 (attachments and platform included).
