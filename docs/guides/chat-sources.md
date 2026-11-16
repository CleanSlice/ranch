# Sources in chat answers

An agent's answer can carry numbered citations — chips after the sentences a
source supports — and a list of those sources under the bubble, in the live
chat of both consoles, on the share page and in the chat history. Two kinds:
**knowledge** (a document of a knowledge base bound to the agent) and **web**
(a page the agent looked up). The runtime builds the list from what its tools
actually returned, hands the model the numbers it may cite, drops any marker
that points at nothing, renumbers the rest and sends one `sources` socket event
per bubble; the hub records every citation and overlays the same rows onto
history. A client gets all of this only when it advertises the `sources`
capability at handshake — Telegram, Slack and the synchronous HTTP reply get
plain text.

Readers can like or dislike a knowledge source (never a web page); the counts
show per source in the knowledge console, sortable. Whether readers may *open*
a cited document is a per-knowledge-base switch (**Readers may open cited
documents**, closed by default); when open, a document is served only to the
reader it was cited to, by the citation, never by the source's id. The
platform team can always open documents. The Ranch agent mirrors the switch
(`set_knowledge_reader_access`) and the counts (`list_knowledge_sources`).
Contract and rationale:
[`specs/020-chat-sources/`](../../specs/020-chat-sources/contracts/sources.md).
