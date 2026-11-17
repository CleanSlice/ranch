# Quickstart: proving agent access end to end

How to bring the feature up locally and run the checks that make it done.
Commands are from the repository root unless a `cd` says otherwise.

## 1. Prerequisites

- Docker Desktop running (Postgres for the local stack). Ask before starting
  it on this machine.
- The local stack of `specs/026-app-console-redesign/quickstart.md`: API on
  `:3333`, app on `:3000`, admin on `:3001`, seeded Owner login in
  `.env.project`.
- playwright-core as described at the top of
  `specs/026-app-console-redesign/e2e/lib.mjs`.

## 2. Bring it up

```bash
cd api
docker compose up -d postgres-local
bun run generate                 # prisma-import + client, picks up the new .prisma files
npx prisma migrate deploy
bun run build && bun run generate:swagger
cd ../admin && bun run build:api
cd ../app && bun run build:api
```

Seed, then start the API and both consoles:

```bash
node specs/032-agent-user-access/e2e/seed.mjs   # agents A, B, C; an Admin limited to A and B; two Users
cd api && PORT=3333 node dist/main
cd admin && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3001
cd app   && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3000
```

## 3. Automated checks

```bash
cd api
NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/user/agentAccess src/slices/agent/pin
NODE_OPTIONS=--experimental-vm-modules npx jest agentScopedRoutes publicRoutes
npx eslint --quiet <touched files>
bun run build

cd ../admin && bun test slices && npx nuxt typecheck
cd ../app   && bun test slices && npx nuxt typecheck
cd .. && bun run locale:check && bun run i18n:check && bun run test:scripts
```

Never `bun run test` in `api/` while a dev API is running.

## 4. Browser scenarios

One entry point: `node specs/032-agent-user-access/e2e/all.mjs`. Each script
runs at 390 px and 1440 px and writes screenshots to the scratchpad.

| Script | Story | Proves |
|--------|-------|--------|
| `owner-editor.mjs` | 1 | deny and allow from the editor; moving an agent between choices; the confirm before opening an account; the outcome sentence |
| `enforce.mjs` | 1, 3 | as the restricted account: list, search, direct link, chat send and a management call for a hidden agent are all "not found"; an open chat is cut when access is removed |
| `ceiling.mjs` | 2 | the limited Admin is offered only A and B; emptying a User's allowed list is refused with the sentence; a hand-made request naming C is refused; entries about C survive the Admin's save |
| `deletion.mjs` | edge | deleting the only allowed agent leaves the account with no agents and the review badge |
| `switch.mjs` | 5 | Owner chats, signs out, a User signs in: no frame shows a message or agent of the Owner; reload as the same account restores at once; the session-ended dialog path |
| `pins.mjs` | 6 | a User pins and unpins; the order holds after a reload and in a second browser context; another account's order is unchanged |
| `http.mjs` | SC-002 | every route in `contracts/enforcement.md` called with the restricted account's token for a hidden agent, expecting 404 or a filtered list |

Part A (CLEAN-232) adds, and is run first:

| Check | Proves |
|-------|--------|
| `npx jest userRoutes agentRoutes publicRoutes` in `api/` | the three sets of routes open below Admin are exactly the reviewed ones |
| `npx jest effectiveCaller toolAudience` in `api/` | every `admin` and `owner` tool refuses a guest and a User; the actor only lowers power |
| `bun test` and `bunx tsc --noEmit -p tsconfig.json` in the runtime clone | the actor chosen per channel, `_meta` on the call, audience mapped to `adminOnly` |
| `routes.mjs` | with a User's token, every route outside the reviewed list answers 403 |
| `assistant.mjs`, needs a real runtime pod or a local runtime on the new version | as a User: "list users", "delete agent X" are refused and nothing changes; as the Owner both work |

## 5. By hand, once

- As Owner in the Ranch assistant chat: "which agents can <user> use?", then
  "let <user> use only <agent>". The assistant states the result, asks, and
  the editor shows the same lists afterwards.
- As the limited Admin, in the Ranch assistant: "list agents" shows only the
  Admin's agents; "restart <hidden agent>" answers that there is no such
  agent.
- As a User, in the Ranch assistant: "can you delete an agent?" The answer is
  no, and `agent_status` shows no management tools.

## 6. Done means

All of section 3 green, `all.mjs` green at both widths with no console error
and no failed request, and the PR says in words which console was checked for
each twin slice touched (`agent`, `bridle`, `user`, `chat`).
