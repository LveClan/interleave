# Native desktop workflow. Optional thin wrapper; no Docker or POSIX shell tools.
NODE ?= node
DESKTOP = "$(NODE)" scripts/desktop.mjs
.DEFAULT_GOAL := help
.PHONY: help doctor setup build dev start smoke package typecheck test e2e lint format seed migrate

help:
	$(DESKTOP) help
doctor setup build dev start package:
	$(DESKTOP) $@
smoke:
	$(DESKTOP) start --smoke
typecheck test e2e lint format seed:
	$(DESKTOP) pnpm $@
migrate:
	$(DESKTOP) pnpm db:migrate
