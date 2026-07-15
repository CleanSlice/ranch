#!/bin/bash
# Wraps `docker compose up -d` for api's `predev`. Turbo interleaves
# admin:dev/app:dev/api:dev logs line-by-line, so a failure here is easy to
# miss or misdiagnose. Capture the output and match on the two failure modes
# we've actually hit locally, instead of guessing at a single cause.
set -o pipefail

cd "$(dirname "$0")/../api" || exit 1

output="$(docker compose up -d 2>&1)"
code=$?
echo "$output" >&2

if [ "$code" -ne 0 ]; then
  if echo "$output" | grep -qiE "unauthorized|denied|403 Forbidden"; then
    cat >&2 <<'EOF'

✖ `docker compose up -d` failed — registry auth error above.

  Most likely cause: ghcr.io/cleanslice/browser-pool is a private image and
  Docker isn't logged into ghcr.io (or the account lacks package access).

  Fix:
    1. Create a GitHub PAT with the `read:packages` scope:
       https://github.com/settings/tokens
    2. docker login ghcr.io -u <your-github-username>
       (paste the PAT as the password)
    3. If you still get 403 after logging in, the token is valid but your
       account lacks read access to the package itself — ask whoever
       administers ghcr.io/cleanslice/browser-pool to grant you access
       (package Settings → Manage Actions access / Collaborators). Repo
       access does not automatically grant package access on GHCR.
    4. Re-run `ranch dev`.
EOF
  elif echo "$output" | grep -qi "no matching manifest"; then
    cat >&2 <<'EOF'

✖ `docker compose up -d` failed — no matching image manifest for your platform.

  ghcr.io/cleanslice/browser-pool is only published for linux/amd64. This
  should already be handled by `platform: linux/amd64` on the browserless
  service in api/docker-compose.yml — if you're still hitting this, check
  that line wasn't reverted.
EOF
  elif echo "$output" | grep -qi "declared as external"; then
    cat >&2 <<'EOF'

✖ `docker compose up -d` failed — the external `k3d-ranch` docker network doesn't exist.

  browserless/minio attach to it so agent runtime pods (inside k3d) can
  reach them. It's created by k3d when the local cluster exists.

  Fix:
    1. brew install k3d   (if not installed)
    2. k3d cluster create ranch --api-port 6550 --wait
    3. Re-run `ranch dev` (it also does this automatically when k3d is
       installed — see cli/src/utils/k3d.ts).
EOF
  else
    cat >&2 <<'EOF'

✖ `docker compose up -d` failed — see the docker-compose output above for the actual error.
EOF
  fi

  cat >&2 <<'EOF'

  Until this succeeds, api can't finish starting, so it never writes
  api/swagger-spec.json — admin/app will sit waiting on it until they time out.
EOF
  exit 1
fi
