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

The scenarios seed and delete agents and connections, so they get a scratch
database of their own next to the development one, and an API on a spare
port. `lib.mjs` refuses anything but a local API and a database whose name
contains `clean236` or `e2e`.

```bash
docker exec ranch-postgres psql -U postgres -c 'CREATE DATABASE ranch_clean236'
cd api
bun run build
DATABASE_URL=<the one in api/.env, with the database name ranch_clean236> npx prisma migrate deploy
DATABASE_URL=<the same> PORT=3399 node dist/main
```

`npx prisma migrate deploy` on the empty database is itself a check: the
whole chain of migrations, this feature's included, applies from nothing.

The scenarios read `JWT_SECRET` and `BRIDLE_API_KEY` from `api/.env` (to sign
in as an agent's runtime) and never print them. `E2E_API` and
`E2E_DATABASE_URL` override the address and the database. `api/.env.dev`
sets `A2A_ALLOW_PRIVATE_PEERS=true`, which is what lets a local API call its
own agents and the stub of `outside.mjs` on 127.0.0.1.

The seed (`seed.mjs`, run by every scenario) makes: the Owner; an Admin who
is denied B; Users U1 (reaches A, B, C) and U2 (reaches A only); agents A
(public), B, C and a Ranch admin agent, as bare rows with no deployment.
Each scenario brings the agents' runtimes itself (`fakeRuntime.mjs`) and
starts from no connections.

For the pages, the two consoles on one host, which is the case FR-038 is
about:

```bash
cd admin && API_URL=http://localhost:3399 NUXT_PUBLIC_API_URL=http://localhost:3399 npx nuxt dev --port 3001
cd app   && API_URL=http://localhost:3399 NUXT_PUBLIC_API_URL=http://localhost:3399 npx nuxt dev --port 3000
```

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

One entry point: `node specs/033-identity-boundaries/e2e/all.mjs` (or
`all.mjs handover visitors` for some). Every line prints PASS or FAIL; the
exit code is the number of failures turned into 0 or 1.

`fakeRuntime.mjs` is an agent runtime with the model taken out: it signs in
to the hub as the agent, records what the hub sends it, and calls Ranch's
tools with the actor a real runtime states for that turn, in the 0.36 and
the 0.35 way (contracts/handover.md §5). So a scenario drives the real hub,
the real MCP server and the real A2A route; only the model is scripted.

| Script | Story | Proves |
|---|---|---|
| `hidden.mjs` | 2 | the Admin denied B: A's colleagues, the agents offered, remove and re-read by id, connect, B's public card; every refusal identical to the one for something that does not exist |
| `connect.mjs` | 1, 3, 9 | from the chat: U1 connects what they reach and removes what they made; U2 is named nothing they do not reach and gets the missing-agent answer for it; an anonymous visitor is offered no connection tool and refused each, whatever the agent says of itself |
| `outside.mjs` | 4 | every spelling of this installation's address refused, as is a redirect to it and a card that points at it; U1's outside colleague is asked in U1's turns only, answers, and is sent no hand-over token; the Owner's is the agent's |
| `visitors.mjs` | 6 | who may open A→B and that it asks to be confirmed; the masked row, and that it can be neither removed nor closed by somebody who does not reach B |
| `handover.mjs` | 2, 6, 7 | A→B→C through three runtimes: the question arrives under the connection with a token and nobody's identity; a question telling B to rewire itself changes nothing; a loop is refused; a closed connection serves nobody who does not reach the colleague, at every hop; an open one serves them masked; the record of hand-overs per reader; B on runtime 0.35 |
| `record.mjs` | 9 | a connection from before the upgrade: nobody's, marked, still answering, and settled by the first decision about it |
| `conversations.mjs` | 5 | what the runtime is sent for the Owner, an Admin, a User and a visitor; an Admin's message during the Owner's turn is its own turn; who reads whose transcript; the Ranch admin agent's conversations are the Owner's |
| `consoles.mjs` | 8 | two accounts, two consoles, one cookie jar, through renewals in both orders and a sign-out of one; a secret carried to the other console; the old shared cookie; a script's sign-in |

By hand, in a browser (no script drives the pages):

- an agent's Peers tab as the Owner and as the Admin, at 390 px and 1440 px:
  the masked row, the "Open to visitors" switch and its confirmation, "Connected
  by", the mark on a connection from before the upgrade;
- the chat of one agent as the Owner and as an Admin, side by side: two
  conversations, and the Owner's old one where it was;
- app as a User and admin as the Owner in one browser profile, through a
  reload of each.

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
