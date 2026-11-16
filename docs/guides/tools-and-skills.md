# Tools and skills

The console is a window; the chat is the hands. Everything the admin console
can do, the Ranch admin agent can do through a tool served by this API's own
MCP server — agents, templates, skills, LLM credentials, MCP servers,
knowledge bases and sources, settings, peers, paddock, users and API keys,
chats and usage, browser sessions, upgrades. Press the wrench beside the chat
composer to see the agent's tools grouped by topic; a click drops a starter
prompt into the composer. Tools added after a pod started show "after restart"
until it restarts. Adding a console capability means adding its tool in the
same PR — see `docs/agent-tools.md` and `specs/016-agent-tool-parity/`.

The Skills page (`/skills` in the admin console) is a library: a summary of
how many skills there are and how big they are in tokens, a strip of one
segment per skill, search and group chips, a shared drag-and-drop order that
every admin sees (it never changes what agents or templates receive), and a
panel per skill with its path, size, templates and activity. New skill and
Edit skill validate the slug as you type and preview the row and the rendered
markdown. See `specs/025-skills-redesign/`.
