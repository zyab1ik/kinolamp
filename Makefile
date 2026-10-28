SHELL := /bin/sh
ACTIONLINT_VERSION := v1.7.12
REVISION ?= $(shell git rev-parse HEAD)
COMPOSE := docker compose --project-name kinolamp --env-file .env -f deployments/compose.yaml
.PHONY: help check check-ci fmt test test-go test-js test-deploy coverage coverage-go coverage-js build run docker-build up down logs health clean

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: ## Check Go formatting, vet and plugin syntax
	@test -z "$$(gofmt -l cmd internal web)" || { echo 'Run make fmt'; exit 1; }
	go vet ./...
	node --check web/static/kp.js

check-ci: ## Validate GitHub Actions workflow syntax and job dependencies
	go run github.com/rhysd/actionlint/cmd/actionlint@$(ACTIONLINT_VERSION) -shellcheck= .github/workflows/ci.yml

fmt: ## Format Go source files
	gofmt -w cmd internal web

test: test-go test-js test-deploy ## Run server and plugin tests

test-go: ## Run Go tests with race detector
	go test -race ./...

test-js: ## Run JavaScript plugin tests (Node.js is only a development tool)
	node --test test/*.test.js

test-deploy: ## Verify image deployment, rollback and restricted SSH commands
	bash -n scripts/deploy-receiver.sh test/deploy.test.sh
	bash test/deploy.test.sh

coverage: coverage-go coverage-js ## Require 100% Go statements and JS lines, branches and functions

coverage-go: ## Require exactly 100% Go statement coverage, with race detector
	@mkdir -p coverage
	go test -race -covermode=atomic -coverprofile=coverage/go.out ./...
	go tool cover -func=coverage/go.out
	@awk 'NR > 1 && $$2 > 0 && $$3 == 0 {missing++} END {if (missing) {print "FAIL: " missing " uncovered Go statement blocks"; exit 1}}' coverage/go.out

coverage-js: ## Require 100% JavaScript lines, branches and functions
	node --experimental-test-coverage --test-coverage-include=web/static/kp.js --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 --test test/*.test.js

build: ## Build a standalone Go binary containing the plugin assets
	@mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/kinolamp ./cmd/kinolamp

run: ## Run locally using the current environment variables
	go run ./cmd/kinolamp

docker-build: ## Build production Docker image
	docker build --label org.opencontainers.image.revision=$(REVISION) -f build/package/Dockerfile -t kinolamp:local .

up: ## Build and start the VPS service
	$(COMPOSE) up -d --build

down: ## Stop the VPS service
	$(COMPOSE) down

logs: ## Follow application logs
	$(COMPOSE) logs -f --tail=50

health: ## Check local container health
	curl --fail --silent --show-error http://127.0.0.1:8788/health

clean: ## Remove build and coverage output
	rm -rf bin coverage
