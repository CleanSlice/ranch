# Contract: what the hub tells the runtime about the person's level (CLEAN-240)

Extends `specs/032-agent-user-access/contracts/acting-party.md` §4 (the
`# Audience` block). Two repositories: the hub is `api/src/slices/bridle` in
this one; the block is written by the runtime (`runtime` repository,
`src/slices/agent/agent/domain/prompts/audience.prompt.ts`).

## The field

The hub's `acting` block on a message gains one optional member:

```
acting: {
  token: string,                      // unchanged — the only thing that grants
  role: 'Owner' | 'Admin' | 'User',   // unchanged — wording only
  surface?: 'app' | 'admin',          // unchanged — wording only
  assistant?: {                       // NEW — wording only
    level: 'owner' | 'basic' | 'standard' | 'full' | 'custom',
  },
}
```

- Present **only** when the message goes to the installation's assistant and
  the sender is a signed-in console person. Absent for every other agent,
  every guest, every `trusted` turn and every hand-over.
- `level` is the person's resolved level at the moment the message is sent
  (`AssistantAccessService.resolveFor`); `'owner'` for the Owner.
- It grants nothing. A runtime that edited it would change what the assistant
  says, never what it may do: the tool list and every tool call are still
  decided by the API from `token`.
- A person whose assistant is off never gets this far: the hub refuses the
  message, as for any agent they do not reach.

## The block

For a turn with `acting.assistant`, the runtime's `# Audience` block gains
these lines after the existing ones. Exact wording is the runtime's; the
content is fixed here.

| `level` | Lines |
|---|---|
| `owner` | The Owner decides who can use you and at which level: Basic, Standard, Full, or a custom choice, per role and per account. When asked what the levels are, who has which, or to change one, call `get_assistant_access` first: it has this installation's definitions and current settings. Explain the levels from what it returns, never from memory. |
| `basic`, `standard`, `full` | This person uses you at the «Level» level. When they ask for something you have no tool for, call `get_my_assistant_access`: if it is left out of their level, say it is not included for their account and that the Owner decides; never describe what other people have. When they ask what their level means, answer from that tool. |
| `custom` | As above, with "a custom set of abilities chosen for them" in place of the level's name. |

Rules for the wording:

- No tool other than `get_assistant_access` and `get_my_assistant_access` is
  named, and `get_assistant_access` only for `owner` — it is not listed for
  anyone else (the existing rule "no Ranch tool is named where a User reads
  it" stays true: `get_my_assistant_access` is listed for every person).
- The existing User sentence "say in one sentence that their account cannot
  do that" stays for a User **without** `acting.assistant` (another agent) and
  is replaced by the level lines when it is present, so the two never
  contradict each other.
- The level's name is taken from a closed list in the runtime; an unknown
  value is treated as if `assistant` were absent.

## Compatibility

| Hub | Runtime | Result |
|---|---|---|
| new | old | The field is ignored. The assistant still explains through `get_my_assistant_access`, whose description tells it to. Nothing breaks. |
| old | new | No field, no extra lines. Today's block. |
| new | new | The lines above. Needs the assistant's pod restarted on the new runtime image. |

## Where the level definitions come from

Never from the runtime. `get_assistant_access` (Owner) and
`get_my_assistant_access` (any person) return a `levels` section built from
the same rule the API enforces:

```
levels: [
  { key: 'basic',    title: 'Basic',    summary: 'See and ask. Changes nothing that belongs to anyone else.',
    areas: [{ key, title, offered, available }] },      // for the role in question
  { key: 'standard', title: 'Standard', summary: 'Basic, plus day-to-day work on agents: …', areas: […] },
  { key: 'full',     title: 'Full',     summary: 'Everything the role can do in the console.', areas: […] },
]
```

`get_assistant_access` returns it for both roles; `get_my_assistant_access`
for the caller's role only, and only up to what that role's ceiling shows. A
level whose contents change with a release is therefore explained correctly
without touching the runtime or any agent file.
