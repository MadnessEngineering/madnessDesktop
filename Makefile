.PHONY: all dev prod install install-app cli kill-app ready-publish

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
