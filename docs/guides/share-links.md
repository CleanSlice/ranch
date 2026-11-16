# Share links

Every agent page has a **Share** action that mints one public link for that
agent: `<console origin>/share?token=sl_…`. Opening it gives a full-view chat
with that agent and nothing else — no login, no navigation, no console pages.

- **Share** is idempotent: an agent that already has an active link hands the
  same one back, so pressing it twice never breaks a link in circulation.
- **Regenerate** mints a new token and kills the old one in the same write —
  the link stays on, the old URL stops working. **Revoke** turns the link off
  entirely. Nothing else ends a token's life: links never expire on their own,
  and an open visitor page notices it was cut off within 30 seconds.
- Visitor requests carry `X-Share-Token` (the secret) and `X-Share-Visitor` (an
  opaque per-browser id) instead of a bearer token, and the console explicitly
  drops its own `Authorization` header on them so an owner previewing their
  link is treated as a visitor. The API re-validates the pair against the agent
  in the path on **every** request.
- Each visitor gets their own conversation, stored on the channel
  `share-<visitorId>`, so share traffic shows up in the agent's chat history for
  console users and is recognisable by that prefix. Attachments are own-only: a
  visitor can read back the files they uploaded to their own chat, nothing else.
- A token grants exactly that one chat — only the agent name and status, no other agents,
  no console routes.

The `AgentShareLink` table ships in the hand-written migration
`api/prisma/migrations/20260907120000_agent_share_link` (additive: a new table
plus a cascading FK, safe on an existing database).
