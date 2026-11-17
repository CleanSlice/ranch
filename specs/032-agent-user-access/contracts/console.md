# Contract: what the consoles show and keep

## Access editor (admin)

On `/users/:id`, a card "Agent access" below the account card. Not shown for
the Owner's account, the viewer's own account, or (to an Admin) another
Admin's: those show one line saying who manages this access.

| Part | Behaviour | Hook for e2e |
|------|-----------|--------------|
| Outcome sentence | one of the four in [data-model.md](../data-model.md), recomputed as rows change, before saving | `data-access-outcome="all\|all_except\|only\|none"` |
| Review banner | shown when `needsReview`: "The last allowed agent was deleted. This account reaches no agents until you choose." | `data-access-review` |
| Outside-view note | shown to an Admin when `hasEntriesOutsideView`: "This account also has access you cannot manage." | `data-access-outside` |
| Search | filters rows by agent name; shown above six agents, as `BindingPicker` does | |
| Row | agent name and status, and one three-way choice: Default, Allowed, Denied | `data-access-row="<agentId>"`, `data-access-choice="none\|allowed\|denied"` |
| Save | disabled until something changed; sends the whole view | `data-access-save` |
| Confirm dialog | opens on `ACCESS_OPEN_NEEDS_CONFIRM`, or before the request when the editor can already tell: "This account will reach every agent that is not denied." | `data-access-confirm` |
| Refusal | the server's `message`, shown as received, under the save button | `data-access-error="<code>"` |

A row has one choice, so an agent cannot be put on both lists from this
screen. On `ACCESS_CHANGED` the editor reloads the access and says someone
else changed it.

User list (`/users`): a badge per row, "Restricted" when the outcome is not
`all`, "Needs review" when `needsReview`. `data-user-access="<kind>"`.

Admin strings are English literals. Agent status is shown through the
existing status label; nothing here formats a date or a number outside
`#common/utils/format`.

## What a restricted Admin sees (admin)

Nothing new to build: every list, counter and search in the admin console
reads the agent store, and the store now receives only reached agents. A
direct link to an unreached agent lands on the existing not-found state. The
Ranch assistant stays available to a restricted Admin unless it is itself
denied; it then works for them within their own reach
([acting-party.md](./acting-party.md)).

## Pins (both consoles)

| Console | Change |
|---------|--------|
| app | the pin control in `workspace/Sheet.vue` moves out of the `canManage` block and the one in `workspace/Rail.vue` out of `canCreate`; `agentStore.setPinned` calls the pin routes |
| admin | `composables/useAgentPin.ts` calls the pin routes |

Ordering (`railOrder`, `orbitLayout`) and badges are unchanged: they read
`agent.pinned`, which is now the caller's own. The optimistic patch and its
rollback stay as they are.

## Empty state (app)

A person who reaches no agents sees, in place of the workspace: a title and
one line saying that access to agents is managed by an administrator. Keys in
`app/slices/agent/i18n/locales/en.json`:

| Key | English |
|-----|---------|
| `agents.no_access_title` | No agents yet |
| `agents.no_access_body` | An administrator decides which agents you can use. Ask them for access. |

`data-agents-empty="no_access"`. Owner and Admin with no agents keep today's
"create your first agent" state.

## Account switch (both consoles)

| Moment | Guarantee | How it is observed |
|--------|-----------|--------------------|
| sign-out | stores emptied and live channels closed before the navigation resolves | no `[data-message-id]` in the DOM after the click |
| sign-in as another account, same tab | first paint of `/agents` shows only the new account's agents; no remembered agent of the previous account is opened | e2e records frames from the click on "Sign in" until the chat is idle and asserts no message id of the previous account appears in any frame |
| reload as the same account | own conversation restored from the browser copy at once, as today | first frame after load has messages |
| sign-in as another account from the session-ended dialog | the page behind the dialog is reset before the dialog closes | same frame assertion |

Stored keys: [data-model.md](../data-model.md), "Browser-kept keys".
