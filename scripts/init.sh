#!/bin/bash
set -e

# ============================================
# Ranch — Interactive Setup
# ============================================

BOLD='\033[1m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${BOLD}${CYAN}[$1/$TOTAL_STEPS]${NC} ${BOLD}$2${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; exit 1; }
ask()  { read -p "  $1: " "$2"; }

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║          Ranch Setup Wizard          ║"
echo "  ║   Agent Deployment Platform on K8s   ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ============================================
# Detect mode
# ============================================

echo -e "${BOLD}What would you like to set up?${NC}"
echo ""
echo "  1) Local development only (Docker + Bun)"
echo "  2) Local + Hetzner Cloud deployment"
echo ""
read -p "  Choose [1/2]: " MODE

if [ "$MODE" = "1" ]; then
  TOTAL_STEPS=5
else
  TOTAL_STEPS=10
fi

# ============================================
# Step 1: Check prerequisites
# ============================================

step 1 "Checking prerequisites"

check_cmd() {
  if command -v "$1" &>/dev/null; then
    ok "$1 $(command $1 --version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+[\.0-9]*' | head -1)"
  else
    warn "$1 not found — installing..."
    eval "$2"
    ok "$1 installed"
  fi
}

check_cmd "bun" "curl -fsSL https://bun.sh/install | bash && export PATH=\$HOME/.bun/bin:\$PATH"
check_cmd "docker" "fail 'Install Docker from https://docs.docker.com/get-docker/'"
check_cmd "kubectl" "brew install kubectl || fail 'Install kubectl: https://kubernetes.io/docs/tasks/tools/'"
check_cmd "k3d" "brew install k3d || fail 'Install k3d: https://k3d.io/'"

if [ "$MODE" = "2" ]; then
  check_cmd "terraform" "brew install terraform || fail 'Install terraform: https://developer.hashicorp.com/terraform/install'"
  check_cmd "kubectl" "brew install kubectl || fail 'Install kubectl: https://kubernetes.io/docs/tasks/tools/'"
  check_cmd "helm" "brew install helm || fail 'Install helm: https://helm.sh/docs/intro/install/'"
  check_cmd "packer" "brew install packer || fail 'Install packer: https://developer.hashicorp.com/packer/install'"
fi

# ============================================
# Step 2: Install dependencies
# ============================================

step 2 "Installing dependencies"

bun install --silent
cd api && bun install --silent && cd ..
cd app && bun install --silent && cd ..
cd admin && bun install --silent && cd ..
ok "All dependencies installed"

# ============================================
# Step 3: Setup local database
# ============================================

step 3 "Setting up local database"

cd api
test -f .env.dev || cp .env.example .env.dev
docker compose up -d 2>/dev/null
ok "PostgreSQL container started"

echo "  Waiting for PostgreSQL..."
until docker compose exec -T postgres-local pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done
ok "PostgreSQL is ready"
cd ..

# ============================================
# Step 4: Run migrations
# ============================================

step 4 "Running database migrations"

cd api
bun add -d prisma@^6 prisma-import dotenv-cli 2>/dev/null
bun add @prisma/client@^6 2>/dev/null
bun run generate 2>/dev/null
npx dotenv-cli -e .env.dev -- npx prisma db push --accept-data-loss 2>/dev/null
npx dotenv-cli -e .env.dev -- npx prisma generate 2>/dev/null
cd ..
ok "Database schema applied"

# ============================================
# Step 5: Local Kubernetes (k3d)
# ============================================

step 5 "Setting up local Kubernetes cluster"

CLUSTER="ranch"
KUBECONFIG_LOCAL="$HOME/.kube/ranch-local.yaml"

if k3d cluster list 2>/dev/null | grep -q "$CLUSTER"; then
  state=$(k3d cluster list 2>/dev/null | grep "$CLUSTER" | awk '{print $2}')
  if echo "$state" | grep -qi running; then
    ok "cluster $CLUSTER: running"
  else
    echo "  Starting cluster..."
    k3d cluster start "$CLUSTER"
    ok "cluster $CLUSTER: started"
  fi
else
  echo "  Creating k3d cluster..."
  k3d cluster create "$CLUSTER" --api-port 6550 --wait
  ok "cluster $CLUSTER: created"
fi

mkdir -p "$(dirname "$KUBECONFIG_LOCAL")"
k3d kubeconfig get "$CLUSTER" > "$KUBECONFIG_LOCAL"
KUBECONFIG="$KUBECONFIG_LOCAL" kubectl create namespace platform 2>/dev/null || true
KUBECONFIG="$KUBECONFIG_LOCAL" kubectl create namespace agents 2>/dev/null || true
KUBECONFIG="$KUBECONFIG_LOCAL" kubectl apply -f k8s/templates/agent-workflow.yaml 2>/dev/null || true
ok "namespaces: platform, agents"
ok "kubeconfig: $KUBECONFIG_LOCAL"

if [ "$MODE" = "1" ]; then
  echo ""
  echo -e "${GREEN}${BOLD}  ✓ Local setup complete!${NC}"
  echo ""
  echo -e "  Start developing:"
  echo -e "    ${CYAN}make dev${NC}          — Start all services"
  echo -e "    ${CYAN}make dev-api${NC}      — API only (http://localhost:3333)"
  echo -e "    ${CYAN}make dev-app${NC}      — App only (http://localhost:3000)"
  echo -e "    ${CYAN}make dev-admin${NC}    — Admin only (http://localhost:3001)"
  echo ""
  echo -e "  Kubernetes:"
  echo -e "    ${CYAN}export KUBECONFIG=$KUBECONFIG_LOCAL${NC}"
  echo -e "    ${CYAN}make k3d-status${NC}   — Cluster status"
  echo ""
  echo -e "  Swagger UI: ${CYAN}http://localhost:3333/api${NC}"
  exit 0
fi

# ============================================
# Step 6: Configure environment
# ============================================

step 6 "Configuring Hetzner environment"

echo ""
ask "Environment name (e.g. mycompany, staging)" ENV_NAME

ENV_DIR="terraform/environments/$ENV_NAME"

if [ -d "$ENV_DIR" ]; then
  warn "Environment '$ENV_NAME' already exists"
else
  cp -r terraform/environments/dev "$ENV_DIR"
  ok "Created $ENV_DIR"
fi

echo ""
echo -e "  ${YELLOW}You need a Hetzner Cloud API token.${NC}"
echo "  Get one at: https://console.hetzner.cloud → Project → Security → API Tokens"
echo ""
ask "Hetzner API token" HCLOUD_TOKEN

ask "Domain (e.g. ranch.mycompany.com)" DOMAIN

MY_IP=$(curl -s ifconfig.me 2>/dev/null || echo "")
if [ -n "$MY_IP" ]; then
  echo -e "  Your IP appears to be: ${CYAN}$MY_IP${NC}"
  read -p "  Use this IP for admin access? [Y/n]: " USE_IP
  if [ "$USE_IP" != "n" ] && [ "$USE_IP" != "N" ]; then
    ADMIN_IP="$MY_IP/32"
  else
    ask "Admin IP (with /32 mask)" ADMIN_IP
  fi
else
  ask "Admin IP (e.g. 1.2.3.4/32, find yours at ifconfig.me)" ADMIN_IP
fi

# Generate SSH key if needed
SSH_KEY="$HOME/.ssh/ranch-$ENV_NAME"
if [ ! -f "$SSH_KEY" ]; then
  ssh-keygen -t ed25519 -C "ranch-$ENV_NAME" -f "$SSH_KEY" -N "" >/dev/null 2>&1
  ok "Generated SSH key: $SSH_KEY"
else
  ok "SSH key exists: $SSH_KEY"
fi

# Write terraform.tfvars
cat > "$ENV_DIR/terraform.tfvars" <<EOF
hcloud_token         = "$HCLOUD_TOKEN"
domain               = "$DOMAIN"
admin_ip             = "$ADMIN_IP"
ssh_public_key_path  = "$SSH_KEY.pub"
EOF

# Update variables.tf defaults
sed -i '' "s/default = \"dev\"/default = \"$ENV_NAME\"/" "$ENV_DIR/variables.tf" 2>/dev/null
sed -i '' "s|default = \"~/.ssh/id_ed25519.pub\"|default = \"$SSH_KEY.pub\"|" "$ENV_DIR/variables.tf" 2>/dev/null
sed -i '' "s|default = \"~/.ssh/id_ed25519\"|default = \"$SSH_KEY\"|" "$ENV_DIR/variables.tf" 2>/dev/null

ok "Configuration saved to $ENV_DIR/terraform.tfvars"

# ============================================
# Step 7: Build MicroOS snapshots
# ============================================

step 7 "Building MicroOS snapshots for k3s"

echo "  This creates OS images on Hetzner for the k3s cluster nodes."
echo "  Takes ~5 minutes. Only needed once per Hetzner account."
echo ""
read -p "  Build snapshots now? [Y/n]: " BUILD_SNAP

if [ "$BUILD_SNAP" != "n" ] && [ "$BUILD_SNAP" != "N" ]; then
  cd /tmp
  curl -sLO https://raw.githubusercontent.com/kube-hetzner/terraform-hcloud-kube-hetzner/master/packer-template/hcloud-microos-snapshots.pkr.hcl
  packer init hcloud-microos-snapshots.pkr.hcl 2>/dev/null

  echo "  Building x86 snapshot..."
  HCLOUD_TOKEN="$HCLOUD_TOKEN" packer build -only=hcloud.microos-x86-snapshot hcloud-microos-snapshots.pkr.hcl 2>&1 | tail -3

  echo "  Building ARM snapshot..."
  HCLOUD_TOKEN="$HCLOUD_TOKEN" packer build -only=hcloud.microos-arm-snapshot hcloud-microos-snapshots.pkr.hcl 2>&1 | tail -3

  cd - >/dev/null
  ok "Snapshots created"
else
  warn "Skipped — run packer manually before terraform apply"
fi

# ============================================
# Step 8: Provision infrastructure
# ============================================

step 8 "Provisioning Hetzner infrastructure"

echo ""
read -p "  Create the cluster now? This costs ~€38/month. [y/N]: " CREATE_INFRA

if [ "$CREATE_INFRA" = "y" ] || [ "$CREATE_INFRA" = "Y" ]; then
  cd "$ENV_DIR"
  terraform init -input=false 2>&1 | tail -3
  ok "Terraform initialized"

  echo "  Running terraform apply..."
  terraform apply -auto-approve 2>&1 | tail -10

  mkdir -p ~/.kube
  terraform output -raw kubeconfig > ~/.kube/ranch-$ENV_NAME 2>/dev/null
  chmod 600 ~/.kube/ranch-$ENV_NAME
  export KUBECONFIG=~/.kube/ranch-$ENV_NAME
  cd - >/dev/null
  ok "Cluster created"
  ok "Kubeconfig saved to ~/.kube/ranch-$ENV_NAME"
else
  warn "Skipped — run 'make infra-apply ENV=$ENV_NAME' when ready"
  echo ""
  echo -e "${GREEN}${BOLD}  ✓ Configuration complete!${NC}"
  echo ""
  echo -e "  When ready to deploy:"
  echo -e "    ${CYAN}make infra-init ENV=$ENV_NAME${NC}"
  echo -e "    ${CYAN}make infra-apply ENV=$ENV_NAME${NC}"
  exit 0
fi

# ============================================
# Step 9: Install platform services
# ============================================

step 9 "Installing platform services"

export KUBECONFIG=~/.kube/ranch-$ENV_NAME

helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null
helm repo add cnpg https://cloudnative-pg.github.io/charts 2>/dev/null
helm repo update >/dev/null 2>&1

echo "  Installing ArgoCD..."
helm install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --set server.ingress.enabled=true \
  --set server.ingress.ingressClassName=traefik \
  --set "server.ingress.hosts[0]=argocd.$DOMAIN" \
  >/dev/null 2>&1
ok "ArgoCD installed"

echo "  Installing Argo Workflows..."
helm install argo-workflows argo/argo-workflows \
  --namespace argo --create-namespace \
  >/dev/null 2>&1
ok "Argo Workflows installed"

echo "  Installing CloudNativePG..."
helm install cnpg cnpg/cloudnative-pg \
  --namespace cnpg-system --create-namespace \
  >/dev/null 2>&1
ok "CloudNativePG installed"

kubectl create namespace platform >/dev/null 2>&1
kubectl create namespace agents >/dev/null 2>&1
kubectl apply -f k8s/templates/agent-workflow.yaml >/dev/null 2>&1
ok "Namespaces and workflow templates created"

# ============================================
# Step 10: Summary
# ============================================

step 10 "Setup complete"

LB_IP=$(kubectl get svc -n traefik traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "<pending>")
ARGOCD_PASS=$(kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || echo "<pending>")

echo ""
echo -e "${GREEN}${BOLD}  ✓ Ranch is deployed!${NC}"
echo ""
echo -e "  ${BOLD}Load Balancer IP:${NC} ${CYAN}$LB_IP${NC}"
echo ""
echo -e "  ${BOLD}Add these DNS records:${NC}"
echo -e "    api.$DOMAIN      A  →  $LB_IP"
echo -e "    app.$DOMAIN      A  →  $LB_IP"
echo -e "    admin.$DOMAIN    A  →  $LB_IP"
echo -e "    argocd.$DOMAIN   A  →  $LB_IP"
echo ""
echo -e "  ${BOLD}ArgoCD:${NC}"
echo -e "    URL:      ${CYAN}https://argocd.$DOMAIN${NC}"
echo -e "    Login:    admin"
echo -e "    Password: $ARGOCD_PASS"
echo ""
echo -e "  ${BOLD}Useful commands:${NC}"
echo -e "    ${CYAN}export KUBECONFIG=~/.kube/ranch-$ENV_NAME${NC}"
echo -e "    ${CYAN}make k8s-status${NC}        — Cluster status"
echo -e "    ${CYAN}make deploy${NC}            — Deploy app-of-apps"
echo -e "    ${CYAN}make dev${NC}               — Local development"
echo ""
