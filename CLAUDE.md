# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Delivery cycle (mandatory)

Applies to Claude Code, SpecKit, Brainstorm, and any other plugin. Plugins do not skip this.

At the start of every task, read `.cursor/rules/project.mdc` (project card) and `.env.project` (API keys). Never print key values.

- Tracker: Jira project `CLEAN`, board [498](https://dreamvention.atlassian.net/jira/software/c/projects/CLEAN/boards/498)
- Issue: `https://dreamvention.atlassian.net/browse/CLEAN-123`
- Team: `CLEAN` — branch `{type}/CLEAN-<n>-short-slug` (`feat`, `fix`, `chore`, …), PR into `main`
- Git author: keep this clone's existing `user.name` / `user.email`. Do not overwrite them.
- Keys: `JIRA_API_TOKEN`, `JIRA_DOMAIN`, `JIRA_EMAIL`, `GITHUB_TOKEN`, and any other tokens in `.env.project` only

**No `CLEAN-<n>` in the request:** the user's description *is* the ticket. Create the Jira issue first (keys in `.env.project`), mark `[ADMIN]` / `[APP]` in the title and labels, **assign it to the Jira user for `JIRA_EMAIL`** (lookup `accountId` via user search, then set assignee). If lookup fails, say so — do not leave the issue unassigned silently. Send back the key/URL, move to In Progress — then branch/code. Do not start SpecKit or implementation without that id.

**OpenAPI:** if SDK/types or `api/swagger-spec.json` are missing, regenerate first (`cd api && bun run generate:swagger` or `bun run build`, then `cd admin && bun run build:api` / `cd app && bun run build:api`). Ask where the schema is only after that fails.

Flow: Jira issue → In Progress → branch from `origin/main` → work + comments on the issue (small: start+end; large: checkpoints) → commit with `CLEAN-<n>` → GitHub PR into `main` → link PR on the issue.

Do not commit, push, or open a PR without a `CLEAN-` id. Do not use Linear in this repo.

**i18n (`app` console):** read `docs/i18n.md` before adding any user-visible
string. `en.json` per slice is the source, `bun run i18n:sync` generates `ru`,
templates use the injected `$t`, and copy decided in script travels as a key.
Never hand-write `ru.json` as the first step. `admin/` stays English-only.

**Client state (`admin` + `app`):** read `docs/state.md` before adding a store,
a fetch or a live feed. An entity lives once in its Pinia store: fetches upsert,
pushes patch, components render by id, `useAsyncData` is for loading state only,
optimistic changes go through the store's `patch()` with a rollback.

**Twin consoles (`admin` + `app`):** seven slices exist in both — `agent`,
`bridle`, `chat`, `common`, `setup`, `share`, `user`. Touching one of them is
not finished until you have looked at its twin. Grep the symbol in both trees,
and say in the PR which console you checked and why the other needed nothing.
Shared behaviour gets copied rather than shared, and the copies drift silently:
`share` currently ships two `buildShareUrl` functions with different env vars
and different token encoding, because CLEAN-104 and CLEAN-110 fixed the same
problem a day apart without meeting. A fix that lands in one console and leaves
the other behind is half a fix, and the missing half is the one the user
clicks.

**Agent tools (`api`):** read `docs/agent-tools.md` before adding or changing
any admin-console capability. The console is a window, the chat is the hands:
a module is not done until the Ranch agent has a tool for what the console
can do — in the slice, with `topic`/`title`/`template`, gated to the right
audience, `confirm` on anything destructive, no secrets in results, and a spec.
The API refuses to boot a tool without that metadata; the PR template asks
for the rest.

Project overview: `README.md`.
