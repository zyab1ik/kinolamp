SHELL := /bin/sh
.PHONY: help check fmt test test-go test-js coverage coverage-go coverage-js build run docker-build up down logs health clean

help: ## Show available commands
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "%-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: ## Check Go formatting, vet and plugin syntax
	@test -z "$$(gofmt -l *.go)" || { echo 'Run make fmt'; exit 1; }
	go vet ./...
	node --check public/kp.js

fmt: ## Format Go source files
	gofmt -w *.go

test: test-go test-js ## Run server and plugin tests

test-go: ## Run Go tests with race detector
	go test -race ./...

test-js: ## Run JavaScript plugin tests (Node.js is only a development tool)
	node --test test/*.test.js

coverage: coverage-go coverage-js ## Require 100% Go statements and JS lines, branches and functions

coverage-go: ## Require exactly 100% Go statement coverage, with race detector
	@mkdir -p coverage
	go test -race -covermode=atomic -coverprofile=coverage/go.out ./...
	go tool cover -func=coverage/go.out
	@awk 'NR > 1 && $$3 == 0 {missing++} END {if (missing) {print "FAIL: " missing " uncovered Go blocks"; exit 1}}' coverage/go.out

coverage-js: ## Require 100% JavaScript lines, branches and functions
	node --experimental-test-coverage --test-coverage-include=public/kp.js --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 --test test/*.test.js

build: ## Build a standalone Go binary containing the plugin assets
	@mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o bin/lampa-kinopub .

run: ## Run locally using the current environment variables
	go run .

docker-build: ## Build production Docker image
	docker build -t lampa-kinopub:local .

up: ## Build and start the VPS service
	docker compose up -d --build

down: ## Stop the VPS service
	docker compose down

logs: ## Follow application logs
	docker compose logs -f --tail=50

health: ## Check local container health
	curl --fail --silent --show-error http://127.0.0.1:8788/health

clean: ## Remove build and coverage output
	rm -rf bin coverage
