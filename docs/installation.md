# Installing Madness Desktop

Madness Desktop runs on macOS 13+ on Apple Silicon. Install a release with
Homebrew, or build from source for the newest code. Releases are cut by hand
and trail the default branch.

## Homebrew

```sh
brew install --cask madnessengineering/tap/madness-desktop
```

This installs the latest
[release](https://github.com/MadnessEngineering/madnessDesktop/releases) into
`/Applications` and links the `madhub` command. If you already have a
from-source build there, add `--force` to replace it.

The build isn't signed or notarized, so macOS blocks the first launch. Clear
the quarantine flag:

```sh
xattr -dr com.apple.quarantine "/Applications/Madness Desktop.app"
```

or try to open it once, then click **Open Anyway** under System Settings →
Privacy & Security.

Update with `brew upgrade --cask madness-desktop`. Don't use `madhub upgrade`
on a Homebrew install: it replaces the app without telling Homebrew.
`brew uninstall --cask madness-desktop` removes the app and keeps your data
directory (see below); add `--zap` to delete that too.

## Building it

```sh
git clone https://github.com/MadnessEngineering/madnessDesktop.git
cd madnessDesktop
yarn
make install
```

`make install` makes a production build, quits Madness Desktop if it's
running, and installs the new app into `/Applications`. Other targets:

- `make install-app` — install the most recent build from `dist/` without
  rebuilding, and refresh the `madhub` link (may ask for `sudo`).
- `make prod` — build only.
- `make dev` — a development build; see
  [contributing/setup.md](contributing/setup.md) for running it.

To update a from-source install:

```sh
git pull
make install
```

## Data directory

`~/Library/Application Support/Madness Desktop/` holds your settings,
repository list, and local state. It's created on first launch and lives
outside the app bundle, so moving, replacing, or upgrading the app keeps it.
A development build uses `~/Library/Application Support/Madness Desktop-dev/`
instead.

## Log files

Logs are written to the `logs` folder inside the data directory, one file per
day: `YYYY-MM-DD.desktop.production.log`. Check the most recent one first when
something goes wrong.
