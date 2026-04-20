#!/usr/bin/env bash
set -euo pipefail

# Reads integrations/github_username + integrations/github_pat from the API
# and creates/updates the ghcr imagePullSecret in the agents namespace,
# then patches the default ServiceAccount to use it.

API_URL=${API_URL:-http://localhost:3333}
NAMESPACE=${NAMESPACE:-agents}
SECRET_NAME=${SECRET_NAME:-ghcr}
REGISTRY_SERVER=${REGISTRY_SERVER:-ghcr.io}

need() { command -v "$1" >/dev/null || { echo "missing: $1"; exit 1; }; }
need kubectl
need curl
need jq

get_setting() {
  local group=$1 name=$2
  curl -s "${API_URL}/settings/${group}/${name}" \
    | jq -r 'if .success then .data.value // "" else "" end'
}

USERNAME=$(get_setting integrations github_username)
PAT=$(get_setting integrations github_pat)

if [[ -z "${USERNAME}" || -z "${PAT}" ]]; then
  echo "Missing settings. Save both in admin UI → Settings:"
  echo "  integrations/github_username"
  echo "  integrations/github_pat"
  exit 1
fi

echo "==> Upserting docker-registry secret '${SECRET_NAME}' in ns '${NAMESPACE}'"
kubectl -n "${NAMESPACE}" delete secret "${SECRET_NAME}" --ignore-not-found >/dev/null
kubectl -n "${NAMESPACE}" create secret docker-registry "${SECRET_NAME}" \
  --docker-server="${REGISTRY_SERVER}" \
  --docker-username="${USERNAME}" \
  --docker-password="${PAT}" \
  --docker-email="${USERNAME}@users.noreply.github.com" \
  >/dev/null

echo "==> Patching ServiceAccount 'default' to use the secret"
kubectl -n "${NAMESPACE}" patch serviceaccount default \
  -p "{\"imagePullSecrets\":[{\"name\":\"${SECRET_NAME}\"}]}" \
  >/dev/null

echo "Done. Existing pods stuck in ImagePullBackOff won't retry with the new secret automatically —"
echo "restart the affected agents (UI or delete their pods) to re-pull."
