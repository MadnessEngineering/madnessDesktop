#!/usr/bin/env bash
# Read-only preflight for cutting a Madness Desktop release (build, GitHub
# release, Homebrew cask bump). It builds nothing and publishes nothing.
#
#   make ready-publish
#
# Exit 0 only when no check FAILed. WARN and INFO lines never fail the run.
# What it cannot prove: that the code compiles, that the unit tests pass, or
# that either sign-in works. tsc and the unit runner have known pre-existing
# failures, so they are not gated here. Do the manual sign-in check below.

cd "$(dirname "$0")/.." || exit 1

REPO=MadnessEngineering/madnessDesktop
BRANCH=madness/init-madness-desktop
TAP_DIR="${TAP_DIR:-../homebrew-tap}"
CASK=madnessengineering/tap/madness-desktop

fails=0
warns=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fails=$((fails + 1)); }
warn() { printf '  warn  %s\n' "$1"; warns=$((warns + 1)); }
info() { printf '  info  %s\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

version="$(node -p "require('./app/package.json').version" 2>/dev/null)"
tag="v$version"
echo "Madness Desktop release preflight for $tag"

echo "git"
if [ -z "$version" ]; then
  bad "could not read version from app/package.json"
fi
current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" = "$BRANCH" ]; then ok "on $BRANCH"; else bad "on '$current', releases are tagged from $BRANCH"; fi
if [ -z "$(git status --porcelain)" ]; then ok "working tree clean"; else bad "uncommitted changes (a mid-build change corrupts the bundle)"; fi
if git fetch --quiet origin "$BRANCH" 2>/dev/null; then
  local_sha="$(git rev-parse HEAD)"
  remote_sha="$(git rev-parse "origin/$BRANCH")"
  if [ "$local_sha" = "$remote_sha" ]; then
    ok "HEAD matches origin/$BRANCH (${local_sha:0:10})"
  else
    bad "HEAD ${local_sha:0:10} differs from origin/$BRANCH ${remote_sha:0:10}, push or pull first"
  fi
else
  bad "could not fetch origin"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  bad "tag $tag already exists on origin, bump the version in app/package.json"
else
  ok "tag $tag is free"
fi
last_subject="$(git log -1 --format=%s)"
case "$last_subject" in
  "chore(release): $tag"*) ok "HEAD is the release commit" ;;
  *) warn "HEAD is not 'chore(release): $tag' (is the version bump committed?)" ;;
esac

echo "sign in config (baked in at build time)"
# Without both of these a prod build falls back to upstream GitHub Desktop's
# dev OAuth app and __DEV_SECRETS__ turns on, which swaps the app onto the dev
# protocol. Browser sign in then cannot complete. Values are never printed.
upstream_dev_id="$(sed -n "s/^const devClientId = '\\(.*\\)'.*/\\1/p" app/app-info.ts)"
if [ -n "${DESKTOP_OAUTH_CLIENT_ID:-}" ]; then
  if [ -n "$upstream_dev_id" ] && [ "$DESKTOP_OAUTH_CLIENT_ID" = "$upstream_dev_id" ]; then
    bad "DESKTOP_OAUTH_CLIENT_ID is upstream GitHub Desktop's dev app"
  else
    ok "DESKTOP_OAUTH_CLIENT_ID set"
  fi
else
  bad "DESKTOP_OAUTH_CLIENT_ID not set in this shell"
fi
if [ -n "${DESKTOP_OAUTH_CLIENT_SECRET:-}" ]; then ok "DESKTOP_OAUTH_CLIENT_SECRET set"; else bad "DESKTOP_OAUTH_CLIENT_SECRET not set in this shell"; fi
if [ -n "${AUTH0_CLIENT_ID:-}" ]; then
  info "AUTH0_CLIENT_ID is set but no longer read (the override is MADNESS_DESKTOP_AUTH0_CLIENT_ID)"
fi
if [ -n "${MADNESS_DESKTOP_AUTH0_CLIENT_ID:-}" ]; then
  info "MADNESS_DESKTOP_AUTH0_CLIENT_ID overrides the default Auth0 client"
else
  info "Auth0 client: default from app/app-info.ts"
fi

echo "tools"
for t in node yarn gh codesign ditto brew; do
  if have "$t"; then ok "$t"; else bad "$t not found"; fi
done
if have gh; then
  if gh auth status >/dev/null 2>&1; then ok "gh is logged in"; else bad "gh is not logged in (gh auth login)"; fi
  if gh release view "$tag" --repo "$REPO" >/dev/null 2>&1; then bad "GitHub release $tag already exists"; else ok "no GitHub release $tag yet"; fi
fi

echo "homebrew tap ($TAP_DIR)"
if [ -d "$TAP_DIR/.git" ]; then
  ok "tap clone found"
  [ -x "$TAP_DIR/scripts/bump-madness-desktop.sh" ] && ok "bump script is executable" || bad "scripts/bump-madness-desktop.sh missing or not executable"
  [ -z "$(git -C "$TAP_DIR" status --porcelain)" ] && ok "tap working tree clean" || bad "tap has uncommitted changes"
  tap_branch="$(git -C "$TAP_DIR" rev-parse --abbrev-ref HEAD)"
  if git -C "$TAP_DIR" fetch --quiet 2>/dev/null; then
    behind="$(git -C "$TAP_DIR" rev-list --count "HEAD..@{u}" 2>/dev/null || echo '?')"
    [ "$behind" = "0" ] && ok "tap up to date on $tap_branch" || warn "tap is behind its upstream by $behind commit(s), pull first"
  else
    warn "could not fetch the tap"
  fi
else
  bad "no homebrew tap clone at $TAP_DIR (set TAP_DIR=...)"
fi

echo "build output (only checked if a build exists)"
app="$(ls -dt dist/*/"Madness Desktop.app" 2>/dev/null | head -1)"
zip="dist/MadnessDesktop-$version-darwin-arm64.zip"
if [ -n "$app" ]; then
  built="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist" 2>/dev/null)"
  if [ "$built" = "$version" ]; then ok "built app is $built"; else warn "built app is '$built', not $version (stale, run yarn build:prod)"; fi
  if codesign --verify --deep --strict "$app" >/dev/null 2>&1; then
    ok "app signature verifies"
  else
    warn "app signature does not verify (ad hoc re-sign: codesign --force --deep --sign - \"$app\")"
  fi
else
  info "no built .app in dist/ (nothing to check before yarn build:prod)"
fi
if [ -f "$zip" ]; then ok "found $zip"; else info "no $zip yet (yarn package)"; fi

echo
echo "manual, not automated:"
echo "  - on a build from this shell, sign in to GitHub.com from the welcome screen"
echo "  - on the same build, Preferences > AI Services > Sign in with Madness Interactive"
echo "  - after publish: brew audit --cask --online --strict $CASK"
echo
if [ "$fails" -gt 0 ]; then
  echo "NOT READY: $fails failed, $warns warning(s)"
  exit 1
fi
echo "READY to build: 0 failed, $warns warning(s)"
