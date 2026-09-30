#!/bin/sh

# The least terrible way to resolve a symlink to its real path.
function realpath() {
  /usr/bin/perl -e "use Cwd;print Cwd::abs_path(@ARGV[0])" "$0";
}

CONTENTS="$(command dirname "$(command dirname "$(command dirname "$(command dirname "$(realpath "$0")")")")")"
BINARY_NAME="$(TERM=dumb command ls "$CONTENTS/MacOS/")"
ELECTRON="$CONTENTS/MacOS/$BINARY_NAME"
CLI="$CONTENTS/Resources/app/cli.js"

# madhub upgrade: pull the latest GitHub release and swap the .app in place.
# Renaming the bundle dir is a same-filesystem rename, so this running script's
# open inode survives the swap. macOS arm64 only (that's all we ship today).
if [ "$1" = "upgrade" ]; then
  REPO="MadnessEngineering/madnessDesktop"
  APP_BUNDLE="$(command dirname "$CONTENTS")"
  CURRENT="$(defaults read "$CONTENTS/Info.plist" CFBundleShortVersionString 2>/dev/null)"

  echo "madhub: current version v${CURRENT:-unknown}"
  echo "madhub: checking latest release..."
  JSON="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest")" || {
    echo "madhub: could not reach GitHub" >&2; exit 1; }

  LATEST="$(printf '%s' "$JSON" | /usr/bin/perl -ne 'if(/"tag_name":\s*"v?([^"]+)"/){print $1;last}')"
  # Releases name the zip MadnessDesktop-<version>-darwin-arm64.zip; v0.1.1 and
  # v0.1.2 shipped as Madness.Desktop-arm64.zip, so take any arm64 zip.
  URL="$(printf '%s' "$JSON" | /usr/bin/perl -ne 'if(/"browser_download_url":\s*"([^"]*arm64\.zip)"/){print $1;last}')"

  if [ -z "$LATEST" ]; then echo "madhub: no release found" >&2; exit 1; fi

  NEWEST="$(printf '%s\n%s\n' "$CURRENT" "$LATEST" | sort -V | tail -1)"
  if [ "$CURRENT" = "$LATEST" ] || [ "$NEWEST" = "$CURRENT" ]; then
    echo "madhub: already up to date (v$CURRENT)"
    exit 0
  fi
  if [ -z "$URL" ]; then echo "madhub: no arm64 zip in v$LATEST" >&2; exit 1; fi

  echo "madhub: upgrading v$CURRENT -> v$LATEST"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT INT TERM
  echo "madhub: downloading $URL"
  curl -fSL --progress-bar "$URL" -o "$TMP/update.zip" || { echo "madhub: download failed" >&2; exit 1; }
  echo "madhub: extracting..."
  ditto -xk "$TMP/update.zip" "$TMP/extracted" || { echo "madhub: extract failed" >&2; exit 1; }

  NEW_APP="$(command find "$TMP/extracted" -maxdepth 2 -name '*.app' -type d | head -1)"
  if [ -z "$NEW_APP" ]; then echo "madhub: no .app inside archive" >&2; exit 1; fi

  SUDO=""
  [ -w "$(command dirname "$APP_BUNDLE")" ] || SUDO="sudo"
  [ -n "$SUDO" ] && echo "madhub: $APP_BUNDLE not writable, using sudo"

  echo "madhub: installing to $APP_BUNDLE"
  $SUDO rm -rf "$APP_BUNDLE.old"
  $SUDO mv "$APP_BUNDLE" "$APP_BUNDLE.old" && $SUDO ditto "$NEW_APP" "$APP_BUNDLE" || {
    echo "madhub: install failed, restoring previous version" >&2
    [ -d "$APP_BUNDLE.old" ] && $SUDO mv "$APP_BUNDLE.old" "$APP_BUNDLE"
    exit 1
  }
  $SUDO rm -rf "$APP_BUNDLE.old"
  $SUDO xattr -dr com.apple.quarantine "$APP_BUNDLE" 2>/dev/null

  echo "madhub: upgraded to v$LATEST 🎩"
  exit 0
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"

exit $?
