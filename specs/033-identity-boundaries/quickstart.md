# Quickstart: proving the identity boundaries end to end

How to bring the feature up locally and run the checks that make it done.
Commands are from the repository root unless a `cd` says otherwise. Rules and
shapes are in [contracts/](./contracts/); this file only says how to run them.

## 1. Prerequisites

- Docker Desktop running (Postgres for the local stack). Ask before starting
  it on this machine.
- The local stack of `specs/026-app-console-redesign/quickstart.md`: API on
  `:3333`, app on `:3000`, admin on `:3001`, seeded Owner login in
  `.env.project`.
- playwright-core as described at the top of
  `specs/026-app-console-redesign/e2e/lib.mjs`.
- A checkout of `CleanSlice/runtime` on the branch of this ticket, for the
  runtime's own tests. No real agent pod is needed: the browser and HTTP
  scenarios use `e2e/fakeRuntime.mjs`.

## 2. Bring it up

```bash
cd api
docker compose up -d postgres-local
bun run generate
npx prisma migrate deploy
bun run build && bun run generate:swagger
cd ../admin && bun run build:api
cd ../app && bun run build:api
```

Seed, then start the API and both consoles on one host, which is the case
FR-038 is about:

```bash
node specs/033-identity-boundaries/e2e/seed.mjs
cd api && PORT=3333 node dist/main
cd admin && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3001
cd app   && API_URL=http://localhost:3333 NUXT_PUBLIC_API_URL=http://localhost:3333 npx nuxt dev --port 3000
```

The seed makes: agents A (public), B, C and an outside stub; the Owner; an
Admin who reaches A and C and is denied B; Users U1 (reaches A, B, C) and U2
(reaches A only); connections A→B (ordinary) and B→C (ordinary).

## 3. Automated checks

```bash
cd api
NODE_OPTIONS=--experimental-vm-modules npx jest src/slices/agent/peer src/slices/bridle src/slices/user/session src/slices/user/auth
NODE_OPTIONS=--experimental-vm-modules npx jest toolAudience mcp-tools.handler agentManage
npx eslint --quiet <touched files>
bun run build

cd ../admin && bun test slices && npx nuxt typecheck
cd ../app   && bun test slices && npx nuxt typecheck
cd .. && bun run locale:check && bun run i18n:check && bun run test:scripts

```

In the runtime checkout:

```bash
bun test && bun run build
```

Never `bun run test` in `api/` while a dev API is running.

## 4. Scenarios

One entry point: `node specs/033-identity-boundaries/e2e/all.mjs`. HTTP
scripts print PASS/FAIL per line; browser scripts run at 390 px and 1440 px
and write screenshots to the scratchpad.

| Script | Story | Proves |
|---|---|---|
| `anonymous.mjs` | 1 | a share visitor of A: no list of agents, no preview, no connect, no remove; A's colleagues identical before and after; only an open connection is asked, shown as "a colleague" |
| `hidden.mjs` | 2 | the Admin denied B: A's colleagues, history, roster, a question only B answers, remove and re-read by id, the fleet map, B's public card. Then B is denied to U1 and gone on the next message |
| `connect.mjs` | 3 | U2 is named nobody but what they reach; connects nothing hidden; the same refusal for a hidden and a missing id, in the chat, through the assistant and on the console route |
| `outside.mjs` | 4 | every spelling of this installation's address refused the same way; U1's outside colleague serves U1 only and is visible to whoever manages A |
| `visitors.mjs` | 6 | who may open A→B; the masked row and the masked step; the chain A→B→C for a caller who reaches A and C and not B, closed and open |
| `handover.mjs` | 7 | B behind an approval gate still answers A; a question telling B to rewire itself changes nothing; two questions at once keep their chains; the fake runtime in both versions (contracts/handover.md §5) |
| `conversations.mjs` | 5 | Owner and Admin on one agent at once: separate windows, a message during the other's turn, the hand-over step in the asker's chat only; the Owner finds the old conversation, the Admin an empty one |
| `consoles.mjs` | 8 | two accounts in two consoles of one browser profile, through a forced renewal, a reload and a sign-out of one; a sign-in from before the upgrade ends with the "session ended" state |
| `record.mjs` | 9 | who connected each colleague; U1 removes their own and is refused the Owner's |

## 5. On the live installation, after release

Order: runtime released and agents restarted, then Ranch
([research.md](./research.md) R14). With the test accounts of `.env.project`
and the agent in `AGENT_FOR_TEST` only:

1. As the test Admin, the public card of the Ranch assistant answers 404
   (it answered 200 on 2026-11-20).
2. As the test User limited to one agent, that agent names no other agent.
3. One cookie jar, two sign-ins with the two console headers: each renewal
   returns its own account.
4. The Owner and the test Admin each send the test agent a message: each
   transcript holds one message.
5. Access lists of the test accounts are put back as they were found.
