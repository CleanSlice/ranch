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
```

Run `ranch --help` or `ranch <cmd> --help` for the full list.

## Local install

From the monorepo root, dependencies are installed by `bun install` because `cli` is registered as a workspace.

To make the `ranch` binary available globally on your machine:

```bash
cd cli
bun link              # registers @cleanslice/ranch in bun's link registry
bun link @cleanslice/ranch   # run from any other directory to link it there
# or: link globally so it works anywhere on your $PATH
ln -sf "$(pwd)/bin/ranch.js" /usr/local/bin/ranch
```

The CLI auto-discovers the Ranch project root by walking upward from the
current directory until it finds a `package.json` with `"name": "ranch"`.
You can also set `RANCH_ROOT` to point at it explicitly.

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

1. Make sure the npm scope `@ranch` is owned by you (or change `name` in
   `cli/package.json` to a scope/name you control — e.g. `@your-org/ranch-cli`).
2. Create an automation token at https://www.npmjs.com/settings/<user>/tokens
   (type: **Automation**, so it bypasses 2FA in CI).
3. In the GitHub repo: **Settings → Secrets and variables → Actions →
   New repository secret** → name `NPM_TOKEN`, value = the token.

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
