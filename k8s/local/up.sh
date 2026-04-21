#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME=${CLUSTER_NAME:-ranch}
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "==> Creating k3d cluster '${CLUSTER_NAME}' (if missing)"
if ! k3d cluster list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "${CLUSTER_NAME}"; then
  k3d cluster create "${CLUSTER_NAME}" \
    --servers 1 --agents 0 \
    --k3s-arg "--disable=traefik@server:*"
else
  echo "    cluster exists, skipping"
fi

echo "==> Ensuring kubectl context"
kubectl config use-context "k3d-${CLUSTER_NAME}" >/dev/null

echo "==> Installing Argo Workflows (Helm)"
helm repo add argo https://argoproj.github.io/argo-helm --force-update >/dev/null
helm repo update >/dev/null
helm upgrade --install argo-workflows argo/argo-workflows \
  --namespace argo --create-namespace \
  --version 0.41.1 \
  --set "server.secure=false" \
  --set "server.extraArgs[0]=--auth-mode=server" \
  --wait --timeout 5m

echo "==> Applying Ranch manifests"
kubectl apply -f "${SCRIPT_DIR}/namespaces.yaml"
kubectl apply -f "${SCRIPT_DIR}/../templates/rbac.yaml"
kubectl apply -f "${SCRIPT_DIR}/../templates/agent-workflow.yaml"
kubectl apply -f "${SCRIPT_DIR}/coredns-host-alias.yaml"
kubectl -n kube-system rollout restart deploy coredns >/dev/null 2>&1 || true
kubectl label node --all node-role=agents --overwrite >/dev/null 2>&1 || true

echo "==> Starting port-forward argo-server :2746 (with auto-reconnect)"
pkill -f "ranch-argo-pf-loop" 2>/dev/null || true
pkill -f "kubectl port-forward -n argo svc/argo-workflows-server" 2>/dev/null || true
: > /tmp/ranch-argo-pf.log
nohup bash -c '
  # ranch-argo-pf-loop
  while true; do
    kubectl port-forward -n argo svc/argo-workflows-server 2746:2746 >> /tmp/ranch-argo-pf.log 2>&1
    echo "[$(date)] port-forward exited ($?), retrying in 2s" >> /tmp/ranch-argo-pf.log
    sleep 2
  done
' > /dev/null 2>&1 &
disown || true

echo "==> Waiting for :2746 to be reachable"
for i in {1..30}; do
  if curl -s -o /dev/null -w '' http://localhost:2746/ 2>/dev/null; then
    break
  fi
  sleep 1
done

echo ""
echo "Ready."
echo "  Argo UI/API: http://localhost:2746"
echo "  Port-forward log: /tmp/ranch-argo-pf.log"
echo "  In api/.env.dev set: WORKFLOW_PROVIDER=argo"
