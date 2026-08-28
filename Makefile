.DEFAULT_GOAL = help
SHELL:=/bin/bash

CURRENT_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null)

.PHONY: help
help:
	@grep -E '(^([a-zA-Z_-]+ ?)+:.*?##.*$$)|(^##)' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[32m%-30s\033[0m %s\n", $$1, $$2}' | sed -e 's/\[32m##/[33m/'

##
## —— Version 🔖 ————————————————
.PHONY: bump
bump: ## Bump the version (package.json + manifest), e.g. make bump VERSION=1.0.1
	@if [ -z "$(VERSION)" ]; then echo "Usage: make bump VERSION=x.y.z (current: $(CURRENT_VERSION))"; exit 1; fi
	@sed -i -E 's/("version": ")[^"]*(")/\1$(VERSION)\2/' package.json src/manifest.json
	@# The lockfile carries the version too, and `npm ci` in the release job
	@# reads it. Bumping without it leaves the published packages disagreeing
	@# with the tag that built them.
	@npm install --package-lock-only --ignore-scripts --silent
	@echo "🔖 Version: $(CURRENT_VERSION) → $(VERSION)"

.PHONY: tag
tag: ## Create the git tag for the current version (triggers the release workflow)
	@git tag -s v$(CURRENT_VERSION) -m "v$(CURRENT_VERSION)"
	@echo "🏷️  Signed tag v$(CURRENT_VERSION) created. Push it: git push origin v$(CURRENT_VERSION)"

##
## —— Build 📦 ————————————————
.PHONY: install
install: ## Install dependencies without running install scripts
	@npm ci --ignore-scripts

.PHONY: test
test: ## Run the test suite
	@npm test

.PHONY: icons
icons: ## Regenerate the icons, then check they still draw the committed image
	@npm run icons
	@npm test -- --test-name-pattern='icons'

.PHONY: sync-signature
sync-signature: ## Resync the vendored author signature and fail if the copy drifted
	@npm run sync:signature
	@git diff --exit-code src/ui/author-signature.css

.PHONY: lint
lint: ## Validate the manifest with addons-linter
	@npm run lint

.PHONY: build
build: ## Build the Chrome and Firefox packages
	@npm run build:chrome
	@npm run build:firefox

.PHONY: sign-firefox
sign-firefox: ## Sign the Firefox xpi via AMO (needs WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
	@npm run sign:firefox

.PHONY: clean
clean: ## Remove generated directories
	@rm -rf build web-ext-artifacts
	@echo "🧹 build/ and web-ext-artifacts/ removed"
