# Quickstart: proving it works (CLEAN-240)

Needs a running stack with an assistant, one Owner, two Admins (A1, A2), two
Users (U1 who created an agent, U2), and at least three ordinary agents.
Accounts for a live installation are in `.env.project`.

## 0. Automated

```
cd api && bun run test -- assistantAccess agentAccess tool-catalog toolReach
cd admin && bun test slices/user && bun run typecheck
cd app && bun test slices && bun run typecheck
bun run locale:check && bun run i18n:check && bun run test:scripts
```

Expected: green. The API must also boot — a tool without `effect` stops it.

## 1. The reported failure is gone (Story 1)

1. As Owner, open A1 → Agent access. The assistant is the first block, not a
   row. Search "ranch" in the agent list: "The assistant is set above."
2. Mark one ordinary agent Allowed, save.
3. As A1: the assistant is in the sidebar and answers. `GET
   /agents/admin/current` → 200.

## 2. Roles (Story 2)

1. Fresh state: `GET /assistant-access` → Admin on/Full, User on/Basic.
2. As U1, ask the assistant to restart the agent U1 created → it says this is
   not included for U1 and the Owner decides (also Story 7).
3. As Owner, set Users to Standard (expect no confirmation: it widens).
4. As U1, same chat, next message, same request → restarted.
5. As Owner, set Admins to Standard (expect "… Admins lose 25 abilities").
6. As A2: "create a user" → not included. "restart agent X" → done.
7. As Owner, switch Users off. As U2: no hub in the orbit; the assistant's
   address is "not found".

## 3. One account (Story 3)

1. Admins on Standard. Set A1 to Full from A1's page: "Set for this account".
2. Change Admins to Basic. A1 still Full; A2 Basic.
3. "Use the Admins' setting" on A1 → Basic.
4. As A2 (Basic), open U1's card: Standard and Full are disabled, "More than
   you have". Open A1's card: no controls.

## 4. Advanced (Story 4)

1. Admins → Advanced, start from Standard, switch "Users & API keys" off,
   untick "Delete an agent", Save. The row reads "Custom · N of 157".
2. As A2: restart works; delete is not included; nothing about users.
3. Pick Full on the row → asked to replace the custom choice.

## 5. Chat (Story 6)

As Owner, to the assistant: "what can Admins do through you?" → matches the
console. "switch yourself off for Users" → states who loses what, waits for
confirmation, then the console shows Users off.

## 6. Carried over (FR-030)

On a copy of pre-update data with: an account with the assistant Denied, one
with it Allowed plus one other agent, one with an Allowed list not naming it.
After migrating: off / on / on; no access entry names the assistant; the
second account still reaches its other agent.

## 7. Nothing leaks

- At every level, as Admin and as User, ask for one ability from each area:
  offered exactly per `GET /assistant-access/catalog` ∩ the role (SC-006).
- A share-link visitor of the assistant gets no management ability at any
  setting.
- `get_my_assistant_access` names no other account.
