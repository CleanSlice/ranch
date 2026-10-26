# Quickstart: verifying CLEAN-175

## Prerequisites

- `api`: `bun install`, then `npx prisma generate` once per fresh worktree.
- Never run `bun run test` while a dev API is running on this machine (it
  re-runs `prisma generate` and crashes the running API); call Jest directly.
- A local API (`bun run start:dev` in `api/`) or the dev instance, an agent
  that is public with `http://localhost:4184` in `allowedOrigins`, and an
  `embed:mint` API key created in the admin console (API keys page). Keep the
  key in a shell variable, never in a command line that gets logged.

## Automated checks

```bash
cd api
npx jest src/slices/user/auth/guards src/slices/user/auth/domain/auth.service.spec.ts src/slices/bridle/bridle.controller.spec.ts src/slices/bridle/domain
bun run build          # typecheck
```

Expected: `publicRoutes.spec.ts` passes with the allowlist from
`research.md` R0; the guard spec has a case "embed token is refused"; the
controller spec has owner / foreign / anonymous / admin cases on a `wslid-…`
channel for GET, DELETE and archive; the auth service spec has the reserved
`sub` and user-id collision cases.

## Manual checks against a running API

```bash
API=http://localhost:3000            # or the dev instance
AGENT=<agentId>
KEY=<embed:mint key>                 # from a variable, not typed into history

# 1. Mint
T=$(curl -s -X POST "$API/auth/embed/token" -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"sub":"wslid-A1234567","expiresIn":"1h"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')

# 2. Auth by default and chat-only embed token: every line must print 401
#    (the agent list, GET /agents, is public by existing design and prints 200
#    for everyone; it is not part of this change)
for p in settings llms knowledges users api-keys; do
  printf '%-10s anon=%s embed=%s\n' "$p" \
    "$(curl -s -o /dev/null -w '%{http_code}' "$API/$p")" \
    "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $T" "$API/$p")"
done

# 3. Still-public routes: 200 (health), 200/4xx by their own guard (not 401 TOKEN_MISSING)
curl -s -o /dev/null -w 'health %{http_code}\n' "$API/health"
curl -s -w ' usage-no-key %{http_code}\n' -o /dev/null -X POST "$API/agents/$AGENT/usage"

# 4. Transcript ownership
curl -s -o /dev/null -w 'anon    %{http_code}\n' "$API/api/agent/$AGENT/transcript?channel=wslid-A1234567"   # 403
curl -s -o /dev/null -w 'owner   %{http_code}\n' -H "Authorization: Bearer $T" "$API/api/agent/$AGENT/transcript?channel=wslid-A1234567"   # 200
curl -s -o /dev/null -w 'foreign %{http_code}\n' -H "Authorization: Bearer $T" "$API/api/agent/$AGENT/transcript?channel=wslid-B9999999"   # 403
curl -s -o /dev/null -w 'missing %{http_code}\n' "$API/api/agent/$AGENT/transcript?channel=wslid-NOBODY"       # 403, same as anon

# 5. Subject validation: every line must print 400
for s in admin '../x' anon-1 share-x http-y 'agent:x'; do
  printf '%-8s %s\n' "$s" "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/embed/token" \
    -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d "{\"sub\":\"$s\"}")"
done
```

## Consoles

- Admin: log in, open an agent chat, read and reset the transcript (channel
  `admin`), open the Chats list and a visitor's conversation. All as before.
- App: log in as a plain user, open an agent chat, reload (history returns),
  "New chat" (archive succeeds). As before.
- Widget: run the Augeo demo (`node serve.mjs` in the task folder, ranch mode
  with a freshly minted key) and confirm "Check it as the hub would" still
  reports the WSLID, the chat keeps its history on reload, and "New chat"
  works. Then the handoff's section 8 script for R1, R3 and R5 passes.

## Twin-console statement for the PR

`bridle` is a twin slice. Checked `admin/slices/bridle` and `app/slices/bridle`:
both read transcripts as `admin` or as the user's own id with the bearer the
interceptor adds, so neither needs a change.
