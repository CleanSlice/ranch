#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME=${CLUSTER_NAME:-ranch}

echo "==> Stopping port-forward"
pkill -f "ranch-argo-pf-loop" 2>/dev/null || true
pkill -f "kubectl port-forward -n argo svc/argo-workflows-server" 2>/dev/null || true

echo "==> Deleting k3d cluster '${CLUSTER_NAME}'"
k3d cluster delete "${CLUSTER_NAME}" 2>/dev/null || true

echo "Done."
