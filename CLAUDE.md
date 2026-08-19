# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Delivery cycle (mandatory)

Applies to Claude Code, SpecKit, Brainstorm, and any other plugin. Plugins do not skip this.

At the start of every task, read `.cursor/rules/project.mdc` (project card) and `.env.project` (API keys). Never print key values.

- Tracker: Jira project `CLEAN`, board [498](https://dreamvention.atlassian.net/jira/software/c/projects/CLEAN/boards/498)
- Issue: `https://dreamvention.atlassian.net/browse/CLEAN-123`
- Team: `CLEAN` — branch `{type}/CLEAN-<n>-short-slug` (`feat`, `fix`, `chore`, …), PR into `main`
- Git identity: folder `E:/code/dream/` → Maksym Hryzodub [DREAM] / `github-dream`
- Keys: `JIRA_API_TOKEN`, `JIRA_DOMAIN`, `JIRA_EMAIL`, `GITHUB_TOKEN`, and any other tokens in `.env.project` only

**No `CLEAN-<n>` in the request:** the user's description *is* the ticket. Create the Jira issue first (keys in `.env.project`), mark `[ADMIN]` / `[APP]` in the title and labels, send back the key/URL, move to In Progress — then branch/code. Do not start SpecKit or implementation without that id.

**OpenAPI:** if SDK/types or `api/swagger-spec.json` are missing, regenerate first (`cd api && bun run generate:swagger` or `bun run build`, then `cd admin && bun run build:api` / `cd app && bun run build:api`). Ask where the schema is only after that fails.

Flow: Jira issue → In Progress → branch from `origin/main` → work + comments on the issue (small: start+end; large: checkpoints) → commit with `CLEAN-<n>` → GitHub PR into `main` → link PR on the issue.

Do not commit, push, or open a PR without a `CLEAN-` id. Do not use Linear in this repo.

Project overview: `README.md`.
