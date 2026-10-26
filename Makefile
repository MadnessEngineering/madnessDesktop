.PHONY: all dev prod install install-app cli kill-app ready-publish sampler sampler-shot

all: dev

# Read-only preflight for a release: git state, sign-in config, tools, the
# Homebrew tap. Builds and publishes nothing. See script/ready-publish.sh.
ready-publish:
	@bash script/ready-publish.sh

dev:
	yarn build:dev

prod:
	yarn build:prod

install:
	yarn build:prod
	@$(MAKE) kill-app
	yarn install:prod

# Stable target the CLI symlink points at.
APP_DEST := /Applications/Madness Desktop.app
CLI_LINK := /usr/local/bin/madhub

# Sync the freshest built .app from dist/ into /Applications, then refresh the
# madhub CLI symlink so `madhub .` keeps working across rebuilds.
install-app: kill-app
	@SRC="$$(ls -dt "dist/"*"/Madness Desktop.app" 2>/dev/null | head -1)"; \
	if [ -z "$$SRC" ]; then echo "No built .app in dist/ — run 'make prod' first." >&2; exit 1; fi; \
	echo "Installing $$SRC -> $(APP_DEST)"; \
	rsync -a --delete "$$SRC/" "$(APP_DEST)/"; \
	$(MAKE) cli

# (Re)create the madhub symlink against the stable /Applications path.
cli:
	@SH="$(APP_DEST)/Contents/Resources/app/static/madhub.sh"; \
	if [ ! -f "$$SH" ]; then echo "madhub.sh missing at $$SH — run 'make install-app'." >&2; exit 1; fi; \
	if [ "$$(readlink "$(CLI_LINK)" 2>/dev/null)" = "$$SH" ]; then echo "madhub already linked."; \
	else echo "Linking $(CLI_LINK) (sudo may prompt)"; sudo ln -sf "$$SH" "$(CLI_LINK)"; fi; \
	echo "Done. Try: madhub ."

# Quit any running Madness Desktop so an install can replace the bundle in
# /Applications. Graceful quit first (lets the app tear down its ptys cleanly),
# then force-kill if it's still up. Never fails when the app isn't running.
kill-app:
	@osascript -e 'quit app "Madness Desktop"' >/dev/null 2>&1 || true; \
	for i in 1 2 3 4 5 6; do pgrep -x "Madness Desktop" >/dev/null 2>&1 || break; sleep 0.5; done; \
	killall "Madness Desktop" >/dev/null 2>&1 || true; \
	echo "Closed running Madness Desktop (if any)."

# Preload sampler: compare what each context-injection path would hand an
# agent, with token costs (docs/terminal-and-ai.md). Reuses a running server,
# otherwise starts one in the foreground; Ctrl-C stops it.
SAMPLER_PORT := 4747
SAMPLER_URL := http://127.0.0.1:$(SAMPLER_PORT)

sampler:
	@if curl -sf -o /dev/null "$(SAMPLER_URL)/"; then \
		echo "Sampler already running at $(SAMPLER_URL)"; open "$(SAMPLER_URL)"; \
	else \
		(sleep 1 && open "$(SAMPLER_URL)") & \
		PORT=$(SAMPLER_PORT) node scripts/archaeology/preload-sampler.mjs; \
	fi

# Re-shoot docs/assets/preload-sampler.png (clicks Measure exact, so it spends
# a few thousand Claude tokens). Starts a temporary sampler if none is up.
# Override with: make sampler-shot REPO=Omnispindle THEME=terminal
REPO ?= madnessDesktop
THEME ?= mad-laboratory
sampler-shot:
	@STARTED=""; \
	if ! curl -sf -o /dev/null "$(SAMPLER_URL)/"; then \
		PORT=$(SAMPLER_PORT) node scripts/archaeology/preload-sampler.mjs >/dev/null & STARTED=$$!; \
		for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf -o /dev/null "$(SAMPLER_URL)/" && break; sleep 0.5; done; \
	fi; \
	node scripts/archaeology/sampler-screenshot.mjs "$(REPO)" "$(THEME)"; RC=$$?; \
	[ -n "$$STARTED" ] && kill $$STARTED; exit $$RC
