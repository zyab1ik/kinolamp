SHELL := /bin/sh
VERSION ?= $(shell cat VERSION)
export VERSION
LDFLAGS := -s -w -X github.com/zyab1ik/kinolamp/internal/app.Version=$(VERSION)
ACTIONLINT_VERSION := v1.7.12
# npm development dependencies may contain their own Go examples.
# Discover every project package, excluding only downloaded third-party sources.
GO_PACKAGES = $(shell go list ./... | sed '\|/node_modules/|d')
REVISION ?= $(shell git rev-parse HEAD)
COMPOSE := docker compose --project-name kinolamp --env-file .env -f deployments/compose.yaml
.PHONY: build-plugin check-plugin fmt-plugin typecheck help check check-ci check-version dist release release-check test-release fmt test test-go test-js test-deploy coverage coverage-go coverage-js build run docker-build up down logs health clean

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: check-version check-plugin ## Check Go and plugin formatting, static analysis and generated assets
	@test -z "$$(gofmt -l cmd internal web)" || { echo 'Run make fmt'; exit 1; }
	go vet $(GO_PACKAGES)
	node --check web/static/kp.js

check-ci: ## Validate GitHub Actions workflow syntax and job dependencies
	go run github.com/rhysd/actionlint/cmd/actionlint@$(ACTIONLINT_VERSION) -shellcheck= .github/workflows/*.yml

check-version: ## Check the release and plugin versions agree
	@printf '%s\n' "$(VERSION)" | LC_ALL=C grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$'
	@test "$(VERSION)" = "$$(cat VERSION)"
	@test "$(VERSION)" = "$$(sed -n "s/ *var VERSION = '\([^']*\)';/\1/p" web/static/kp.js)" || { echo 'VERSION and kp.js disagree'; exit 1; }

fmt: fmt-plugin ## Format Go and plugin source files
	gofmt -w cmd internal web

typecheck: node_modules/.package-lock.json ## Check strict TypeScript contracts without emitting runtime files
	npm run typecheck

node_modules/.package-lock.json: package.json package-lock.json
	npm ci --ignore-scripts --no-audit --no-fund

build-plugin: node_modules/.package-lock.json ## Build the readable ES5 plugin from web/plugin sources
	npm run build:plugin

check-plugin: node_modules/.package-lock.json ## Check TypeScript, lint sources, verify ES5 and check the committed bundle is up to date
	npm run check

fmt-plugin: node_modules/.package-lock.json ## Format plugin sources and rebuild kp.js
	npm run format
	npm run build:plugin

test: test-go test-js test-deploy test-release ## Run server and plugin tests

test-go: ## Run Go tests with race detector
	go test -race $(GO_PACKAGES)

test-js: check-plugin ## Run JavaScript plugin tests (Node.js is only a development tool)
	node --test test/*.test.js

test-deploy: ## Verify image deployment, rollback and restricted SSH commands
	bash -n scripts/deploy-receiver.sh test/deploy.test.sh
	bash test/deploy.test.sh

coverage: coverage-go coverage-js ## Require 100% Go statements and JS lines, branches and functions

coverage-go: ## Require exactly 100% Go statement coverage, with race detector
	@mkdir -p coverage
	go test -race -covermode=atomic -coverprofile=coverage/go.out $(GO_PACKAGES)
	go tool cover -func=coverage/go.out
	@awk 'NR > 1 && $$2 > 0 && $$3 == 0 {missing++} END {if (missing) {print "FAIL: " missing " uncovered Go statement blocks"; exit 1}}' coverage/go.out

coverage-js: check-plugin ## Require 100% JavaScript lines, branches and functions
	node --experimental-test-coverage --test-coverage-include=web/static/kp.js --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 --test test/*.test.js

build: ## Build a standalone Go binary containing the plugin assets
	@mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o bin/kinolamp ./cmd/kinolamp

run: ## Run locally using the current environment variables
	go run -ldflags="$(LDFLAGS)" ./cmd/kinolamp

docker-build: ## Build production Docker image
	docker build --build-arg VERSION=$(VERSION) --label org.opencontainers.image.version=$(VERSION) --label org.opencontainers.image.revision=$(REVISION) -f build/package/Dockerfile -t kinolamp:local .

up: ## Build and start the VPS service
	$(COMPOSE) up -d --build

down: ## Stop the VPS service
	$(COMPOSE) down

logs: ## Follow application logs
	$(COMPOSE) logs -f --tail=50

health: ## Check local container health
	curl --fail --silent --show-error http://127.0.0.1:8788/health

dist: check-version ## Build Linux amd64/arm64 release archives, plugin and checksums
	bash scripts/build-release.sh

release-check: check-version ## Validate the version and clean, synchronized main before tagging
	bash scripts/tag-release.sh --check

release: check-version ## Optionally pre-tag main; publishing still waits for successful CI and deployment
	bash scripts/tag-release.sh

test-release: ## Verify release guards against local disposable Git repositories
	bash -n scripts/build-release.sh scripts/tag-release.sh scripts/release-plan.sh test/release.test.sh
	bash test/release.test.sh

clean: ## Remove build and coverage output
	rm -rf bin coverage dist
