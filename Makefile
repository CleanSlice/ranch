.PHONY: init setup install db db-wait migrate generate dev dev-api dev-app dev-admin down stop clean help free-ports
.PHONY: infra-init infra-plan infra-apply infra-destroy kubeconfig deploy argocd-password
.PHONY: k3d k3d-stop k3d-clean k3d-status
.PHONY: lightrag-up lightrag-down lightrag-logs lightrag-reset
.PHONY: pf-argo

# ============================================
# Ranch - CleanSlice Agent Platform
# ============================================

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

init: ## Interactive setup wizard (local + optional Hetzner deploy)
	@bash scripts/init.sh

setup: install db db-wait migrate k3d ## Full local setup (non-interactive)
	@echo ""
	@echo "Setup complete! Run: make dev"

install: ## Install all dependencies
	bun install
	cd api && bun install
	cd app && bun install
	cd admin && bun install

db: ## Start PostgreSQL via Docker
	cd api && docker compose up -d

db-wait:
	@echo "Waiting for PostgreSQL..."
	@cd api && until docker compose exec -T postgres-local pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	@echo "PostgreSQL is ready."

db-stop: ## Stop PostgreSQL
	cd api && docker compose down

db-reset: ## Reset database (destroy data)
	cd api && docker compose down -v

lightrag-up: ## Start LightRAG stack (Ollama + Postgres + LightRAG). First run pulls ~3GB of models.
	@echo "Starting Ollama..."
	docker compose -f api/docker-compose.yml --profile rag up -d ollama
	@echo "Waiting for Ollama to be ready..."
	@until curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; do sleep 2; done
	@echo "Pulling models (skipped if already downloaded)..."
	@docker exec ranch-ollama ollama pull llama3.2:latest
	@docker exec ranch-ollama ollama pull nomic-embed-text:latest
	@echo "Starting LightRAG + Postgres..."
	docker compose -f api/docker-compose.yml --profile rag up -d
	@echo "Done. LightRAG at http://localhost:9621"

lightrag-down: ## Stop LightRAG stack (keeps data)
	docker compose -f api/docker-compose.yml --profile rag down

lightrag-reset: ## Wipe LightRAG stack including Postgres + Ollama data (destructive!)
	docker compose -f api/docker-compose.yml --profile rag down -v

lightrag-logs: ## Tail LightRAG container logs
	docker compose -f api/docker-compose.yml logs -f lightrag

migrate: generate ## Run Prisma migrations
	cd api && test -f .env.dev || cp .env.example .env.dev
	cd api && dotenv -e .env.dev -- npx prisma migrate dev --name init 2>/dev/null || cd api && dotenv -e .env.dev -- npx prisma db push
	cd api && dotenv -e .env.dev -- npx prisma generate

generate: ## Generate schema.prisma from slices
	cd api && bun run generate

studio: ## Open Prisma Studio
	cd api && bun run studio

free-ports: ## Kill processes on ports 3000, 3001, 3002 and free 5432
	@for port in 3000 3001 3002; do \
		pid=$$(lsof -ti :$$port 2>/dev/null); \
		if [ -n "$$pid" ]; then \
			echo "Killing process on port $$port (PID $$pid)"; \
			kill -9 $$pid 2>/dev/null; \
		fi; \
	done
	@container=$$(docker ps -q --filter "publish=5432" 2>/dev/null); \
	if [ -n "$$container" ]; then \
		echo "Stopping container on port 5432 ($$container)"; \
		docker stop $$container > /dev/null; \
	fi

dev: free-ports k3d lightrag-up ## Start all services (api + app + admin + k3d + lightrag)
	bun run dev

dev-api: free-ports ## Start API only (port 3000)
	bun run dev:api

dev-app: free-ports ## Start app only (port 3001)
	bun run dev:app

dev-admin: free-ports ## Start admin only (port 3002)
	bun run dev:admin

build: ## Build all services
	bun run build

lint: ## Lint all services
	bun run lint

test: ## Run tests
	bun run test

down: ## Stop all services and free ports
	@for port in 3000 3001 3333; do \
		pid=$$(lsof -ti :$$port 2>/dev/null); \
		if [ -n "$$pid" ]; then \
			echo "Killing process on port $$port (PID $$pid)"; \
			kill $$pid 2>/dev/null || true; \
		fi; \
	done
	@cd api && docker compose down 2>/dev/null || true
	@k3d cluster stop ranch 2>/dev/null || true
	@echo "All services stopped."

stop: down ## Alias for down

clean: ## Remove node_modules and build artifacts
	rm -rf node_modules api/node_modules app/node_modules admin/node_modules
	rm -rf api/dist app/.nuxt app/.output admin/.nuxt admin/.output
	rm -rf .turbo api/.turbo app/.turbo admin/.turbo

# ============================================
# Local Kubernetes (k3d)
# ============================================

CLUSTER    := ranch
KUBECONFIG_LOCAL := $(HOME)/.kube/ranch-local.yaml

k3d: ## Create/start local k3d cluster
	@echo "── Checking k3d ──"
	@command -v k3d >/dev/null 2>&1 || (echo "  Installing k3d..." && brew install k3d)
	@if k3d cluster list 2>/dev/null | grep -q "$(CLUSTER)"; then \
		state=$$(k3d cluster list 2>/dev/null | grep "$(CLUSTER)" | awk '{print $$2}'); \
		if echo "$$state" | grep -qi running; then \
			echo "  cluster $(CLUSTER): running"; \
		else \
			echo "  cluster $(CLUSTER): starting..."; \
			k3d cluster start $(CLUSTER); \
		fi; \
	else \
		echo "  cluster $(CLUSTER): creating..."; \
		k3d cluster create $(CLUSTER) --api-port 6550 --wait; \
	fi
	@mkdir -p $$(dirname $(KUBECONFIG_LOCAL))
	@k3d kubeconfig get $(CLUSTER) > $(KUBECONFIG_LOCAL)
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl create namespace platform 2>/dev/null || true
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl create namespace agents 2>/dev/null || true
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl apply -f k8s/templates/rbac.yaml 2>/dev/null || true
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl apply -f k8s/templates/agent-workflow.yaml 2>/dev/null || true
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl apply -f k8s/local/coredns-host-alias.yaml 2>/dev/null || true
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl -n kube-system rollout restart deploy coredns 2>/dev/null || true
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl label node --all node-role=agents --overwrite 2>/dev/null || true
	@echo "  namespaces: platform, agents"
	@echo "  kubeconfig: $(KUBECONFIG_LOCAL)"
	@echo ""
	@echo "  Run: export KUBECONFIG=$(KUBECONFIG_LOCAL)"

k3d-stop: ## Stop local k3d cluster
	@k3d cluster stop $(CLUSTER) 2>/dev/null || true
	@echo "Cluster $(CLUSTER) stopped."

k3d-clean: ## Delete local k3d cluster
	@k3d cluster delete $(CLUSTER) 2>/dev/null || true
	@rm -f $(KUBECONFIG_LOCAL)
	@echo "Cluster $(CLUSTER) deleted."

pf-argo: ## Port-forward Argo Workflows server to localhost:2746 (needed for `dev-api` to talk to Argo)
	@if lsof -iTCP:2746 -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "  port 2746 already in use — assuming a forward is running"; \
	else \
		echo "  forwarding argo-workflows-server -> localhost:2746"; \
		kubectl port-forward -n argo svc/argo-workflows-server 2746:2746; \
	fi

k3d-status: ## Show local cluster status
	@echo "=== Cluster ==="
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl get nodes 2>/dev/null || echo "  Not running. Run: make k3d"
	@echo ""
	@echo "=== Platform ==="
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl get pods -n platform 2>/dev/null || true
	@echo ""
	@echo "=== Agents ==="
	@KUBECONFIG=$(KUBECONFIG_LOCAL) kubectl get pods -n agents 2>/dev/null || true

# ============================================
# Hetzner / Terraform
# ============================================

ENV ?= dev

infra-init: ## Initialize Terraform (ENV=dev|prod)
	cd terraform/environments/$(ENV) && terraform init

infra-plan: ## Preview infrastructure changes (ENV=dev|prod)
	cd terraform/environments/$(ENV) && terraform plan

infra-apply: ## Apply infrastructure (ENV=dev|prod)
	cd terraform/environments/$(ENV) && terraform apply

infra-destroy: ## Destroy infrastructure (ENV=dev|prod)
	cd terraform/environments/$(ENV) && terraform destroy

kubeconfig: ## Get kubeconfig from Terraform (ENV=dev|prod)
	cd terraform/environments/$(ENV) && terraform output -raw kubeconfig > ~/.kube/ranch-$(ENV)
	@echo "Run: export KUBECONFIG=~/.kube/ranch-$(ENV)"

# ============================================
# Kubernetes / Deploy
# ============================================

argocd-password: ## Get ArgoCD admin password
	@kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d && echo

deploy: ## Deploy app-of-apps + workflow templates to cluster
	kubectl apply -f k8s/argocd/app-of-apps.yaml
	kubectl apply -f k8s/templates/agent-workflow.yaml
	@echo "Deployed. ArgoCD will sync the rest."

k8s-secrets: ## Create API secrets in cluster (interactive)
	@echo "Creating ranch-api-env secret in platform namespace..."
	@read -p "DATABASE_URL: " db_url; \
	kubectl create namespace platform --dry-run=client -o yaml | kubectl apply -f -; \
	kubectl create secret generic ranch-api-env \
		--namespace platform \
		--from-literal=NODE_ENV=production \
		--from-literal=PORT=3000 \
		--from-literal=CORS_ORIGIN="https://app.ranch.example.com,https://admin.ranch.example.com" \
		--from-literal=DATABASE_URL="$$db_url" \
		--from-literal=ARGO_WORKFLOWS_URL="http://argo-workflows-server.argo:2746" \
		--dry-run=client -o yaml | kubectl apply -f -
	@echo "Secret created."
	@echo "Creating lightrag-api secret in platform namespace..."
	@read -s -p "LightRAG API key: " LIGHTRAG_API_KEY; echo; \
	  read -s -p "OpenAI API key: " OPENAI_API_KEY; echo; \
	  kubectl -n platform create secret generic lightrag-api \
	    --from-literal=apiKey="$$LIGHTRAG_API_KEY" \
	    --from-literal=openaiApiKey="$$OPENAI_API_KEY" \
	    --dry-run=client -o yaml | kubectl apply -f -
	@echo "LightRAG secret created."
	@echo "Creating pg-backup-aws secret in platform namespace..."
	@read -s -p "AWS access key id (for pg-backups): " ACCESS_KEY_ID; echo; \
	  read -s -p "AWS secret access key (for pg-backups): " ACCESS_SECRET_KEY; echo; \
	  kubectl -n platform create secret generic pg-backup-aws \
	    --from-literal=ACCESS_KEY_ID="$$ACCESS_KEY_ID" \
	    --from-literal=ACCESS_SECRET_KEY="$$ACCESS_SECRET_KEY" \
	    --dry-run=client -o yaml | kubectl apply -f -
	@echo "pg-backup-aws secret created."

k8s-status: ## Show cluster status
	@echo "=== Nodes ==="
	@kubectl get nodes
	@echo ""
	@echo "=== Platform Pods ==="
	@kubectl get pods -n platform
	@echo ""
	@echo "=== Agent Pods ==="
	@kubectl get pods -n agents
	@echo ""
	@echo "=== ArgoCD Apps ==="
	@kubectl get applications -n argocd

k8s-logs-api: ## Tail API logs
	kubectl logs -n platform -l app=ranch-api -f
