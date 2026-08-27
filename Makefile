# Tarmac — the paved road.
#
# `make up` is the whole story: from a clean machine with Docker, to a running
# service you can open in a browser.

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

ENVIRONMENT ?= dev
TARGET      ?= local
IMAGE_NAME  ?= tarmac/hello-world
GIT_COMMIT  := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
APP_VERSION ?= 0.1.0
IMAGE       ?= $(IMAGE_NAME):$(GIT_COMMIT)

SCRIPTS := platform/scripts

.PHONY: help
help: ## Show this help
	@echo "Tarmac — paved road platform"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Variables: ENVIRONMENT=$(ENVIRONMENT) TARGET=$(TARGET)"

# ---------------------------------------------------------------------------
# The one command that matters
# ---------------------------------------------------------------------------

.PHONY: up
up: emulator-start build deploy ## Bring up everything and deploy to dev

# ---------------------------------------------------------------------------
# Local development
# ---------------------------------------------------------------------------

.PHONY: install
install: ## Install dependencies
	npm install

.PHONY: dev
dev: ## Run the app locally with hot reload
	npm run dev --workspace @tarmac/hello-world

.PHONY: build
build: ## Build the application and its container image
	npm run build --workspace @tarmac/hello-world
	docker build -f apps/hello-world/Dockerfile -t $(IMAGE) \
		--build-arg APP_VERSION=$(APP_VERSION) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) .

.PHONY: test
test: ## Run every test suite
	npm test --workspaces --if-present

.PHONY: validate
validate: ## Validate the service manifest (the same check CI runs)
	node platform/validate/dist/cli.js apps/hello-world/service.yaml

.PHONY: check
check: ## Everything CI checks, locally
	npm run typecheck --workspaces --if-present
	$(MAKE) test
	$(MAKE) validate
	$(MAKE) tf-validate

# ---------------------------------------------------------------------------
# Emulators
# ---------------------------------------------------------------------------

.PHONY: emulator-start
emulator-start: ## Start one emulator per environment
	@$(SCRIPTS)/emulator.sh start

.PHONY: emulator-stop
emulator-stop: ## Stop the emulators and clean up task containers
	@$(SCRIPTS)/emulator.sh stop

.PHONY: emulator-status
emulator-status: ## Show emulator status
	@$(SCRIPTS)/emulator.sh status

# ---------------------------------------------------------------------------
# Deployment
# ---------------------------------------------------------------------------

.PHONY: deploy
deploy: ## Deploy to $(ENVIRONMENT) on $(TARGET)
	@EXPECT_COMMIT=$(GIT_COMMIT) $(SCRIPTS)/deploy.sh $(ENVIRONMENT) $(TARGET) $(IMAGE)

.PHONY: url
url: ## Print the deployed service URL
	@cd infra && terraform workspace select $(ENVIRONMENT) >/dev/null 2>&1 && terraform output -raw service_url && echo

.PHONY: logs
logs: ## Tail the service logs
	@docker logs -f $$(docker ps --filter 'name=ministack-ecs' --format '{{.Names}}' | head -1)

.PHONY: tf-validate
tf-validate: ## Validate and format-check the Terraform
	cd infra && terraform init -backend=false -input=false >/dev/null && terraform validate && terraform fmt -check -recursive

.PHONY: down
down: ## Tear down local infrastructure and stop the emulators
	-cd infra && terraform workspace select $(ENVIRONMENT) >/dev/null 2>&1 && \
		terraform destroy -auto-approve -var-file=envs/local-$(ENVIRONMENT).tfvars -var="image=$(IMAGE)" >/dev/null 2>&1
	@$(MAKE) emulator-stop

# ---------------------------------------------------------------------------
# Real AWS — manual only. Nothing in CI targets these.
# ---------------------------------------------------------------------------

.PHONY: deploy-aws
deploy-aws: build ## Deploy to real AWS (manual, costs money, tagged for teardown)
	@echo "Deploying to REAL AWS in $(ENVIRONMENT). Everything created is tagged Platform=tarmac."
	@EXPECT_COMMIT=$(GIT_COMMIT) $(SCRIPTS)/deploy.sh $(ENVIRONMENT) aws $(IMAGE)

.PHONY: destroy-aws
destroy-aws: ## Remove everything the road created in real AWS
	cd infra && terraform workspace select $(ENVIRONMENT) && \
		terraform destroy -var-file=envs/aws-$(ENVIRONMENT).tfvars -var="image=$(IMAGE)"
