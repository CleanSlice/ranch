# @cleanslice/ranch

Thin CLI wrapper for the Ranch monorepo. Replaces the most-used `make` targets with a single `ranch` command.

## Commands

```
ranch dev [api|app|admin]   Start dev servers (all by default)
ranch down                   Stop dev servers, postgres and k3d
ranch stop                   Alias for down
ranch db <action>            start | stop | reset | studio
ranch generate               Regenerate Prisma schema from slices
ranch status                 Show what's currently running locally
ranch where                  Show which Ranch root the CLI is using
```

Run `ranch --help` or `ranch <cmd> --help` for the full list.

## Install

Install globally so the `ranch` command is available everywhere:

```bash
npm i -g @cleanslice/ranch
# or
bun add -g @cleanslice/ranch
pnpm add -g @cleanslice/ranch
yarn global add @cleanslice/ranch
```

> **Note: the `-g` (global) flag is required.** Without it the package
> is installed only into a project's local `node_modules/.bin` and
> the `ranch` command will not be on your `$PATH` — you'd have to
> invoke it with `npx ranch …`.

Verify:

```bash
ranch --help
```

## First run — auto-setup

The first time you run `ranch <command>` outside of a Ranch checkout,
the CLI offers to set one up:

- **Clone `CleanSlice/ranch`** into a directory of your choice and
  optionally run `bun install` there.
- **Point at an existing local copy** if you've already cloned it
  somewhere.

The chosen path is cached at:

- `~/.config/ranch/config.json` on macOS / Linux
- `%APPDATA%\ranch\config.json` on Windows

Subsequent `ranch` commands work from anywhere — no need to `cd` into
the project. Inspect / re-discover with `ranch where`.

Resolution order (first match wins):

1. `RANCH_ROOT` environment variable
2. `package.json#name === "ranch"` walking up from the current directory
3. The cached path from the config file
4. Interactive setup

## Local development

From the monorepo root, `bun install` will pick up `cli/` because it's
registered as a workspace. To run the CLI from source while iterating:

```bash
cd cli
bun run dev -- --help          # runs src/cli.ts directly via bun
```

To link your working copy as if it were globally installed:

```bash
cd cli
bun link
bun link @cleanslice/ranch     # run from any other directory
```

## Standalone binary

Bun can compile the CLI to a single self-contained executable:

```bash
cd cli
bun run compile
# produces ./dist/ranch — copy it anywhere on $PATH
```

The compiled binary still shells out to `bun`, `docker`, `k3d`, `kubectl`,
so those tools must be present on the host.

## Publishing to npm

Releases are automated by `.github/workflows/publish-cli.yaml`.

**One-time setup:**

1. The npm scope `@cleanslice` already exists and is owned by `dmitriyzhuk`.
   Add other maintainers via `npm org set cleanslice <user> developer`.
2. Create an automation token at https://www.npmjs.com/settings/<user>/tokens
   (type: **Automation**, so it bypasses 2FA in CI).
3. In the GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret** → name `NPM_TOKEN`, value = the token.
4. The repository **must be public** — npm provenance refuses to verify
   packages built from private GitHub Actions runs.

**To cut a release:**

```bash
# 1. Bump the version in cli/package.json (semver)
cd cli
npm version patch          # or minor / major  → edits package.json
cd ..

# 2. Commit and push the version bump
git add cli/package.json
git commit -m "chore(cli): release v$(node -p "require('./cli/package.json').version")"
git push

# 3. Tag and push — this triggers the workflow
VERSION=$(node -p "require('./cli/package.json').version")
git tag "cli-v$VERSION"
git push origin "cli-v$VERSION"
```

The workflow will:

- check out the repo,
- install deps with bun,
- verify the tag (`cli-v0.1.0`) matches `cli/package.json` version,
- run `bun run build` to produce `dist/ranch.mjs`,
- `npm publish --provenance --access public` from `cli/`.

**Manual publish (one-off, e.g. to test on the `next` dist-tag):**
GitHub → **Actions → Publish CLI → Run workflow** and pick a dist-tag.

**Installing the published CLI:**

```bash
npm install -g @cleanslice/ranch
ranch --help
```
