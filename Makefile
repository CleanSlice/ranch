.PHONY: init setup install db db-wait migrate generate dev dev-api dev-app dev-admin stop clean help free-ports
.PHONY: infra-init infra-plan infra-apply infra-destroy kubeconfig deploy argocd-password

# ============================================
# Ranch - CleanSlice Agent Platform
# ============================================

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

init: ## Interactive setup wizard (local + optional Hetzner deploy)
	@bash scripts/init.sh

setup: install db db-wait migrate ## Full local setup (non-interactive)
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

migrate: generate ## Run Prisma migrations
	cd api && test -f .env.dev || cp .env.example .env.dev
	cd api && dotenv -e .env.dev -- npx prisma migrate dev --name init 2>/dev/null || cd api && dotenv -e .env.dev -- npx prisma db push
	cd api && dotenv -e .env.dev -- npx prisma generate

generate: ## Generate schema.prisma from slices
	cd api && bun run generate

studio: ## Open Prisma Studio
	cd api && bun run studio

free-ports: ## Kill processes on ports 3000, 3001, 3002
	@for port in 3000 3001 3002; do \
		pid=$$(lsof -ti :$$port 2>/dev/null); \
		if [ -n "$$pid" ]; then \
			echo "Killing process on port $$port (PID $$pid)"; \
			kill -9 $$pid 2>/dev/null; \
		fi; \
	done

dev: free-ports ## Start all services (api + app + admin)
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

stop: db-stop ## Stop all services

clean: ## Remove node_modules and build artifacts
	rm -rf node_modules api/node_modules app/node_modules admin/node_modules
	rm -rf api/dist app/.nuxt app/.output admin/.nuxt admin/.output
	rm -rf .turbo api/.turbo app/.turbo admin/.turbo

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
