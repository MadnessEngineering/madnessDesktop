# Installing Madness Desktop

Madness Desktop ships one build: an **unsigned macOS app for Apple Silicon
(arm64)**, attached to each [GitHub release](https://github.com/MadnessEngineering/madnessDesktop/releases).
There's no Intel, Windows, or Linux release. The source still carries
upstream GitHub Desktop's Windows and Linux build paths, but nobody builds or
tests them for this fork.

Releases are cut by hand and trail `main`. For the newest work, build it
yourself (below).

## From a release

1. Download the latest release's `arm64` zip —
   `MadnessDesktop-<version>-darwin-arm64.zip` (v0.1.1 and v0.1.2 named it
   `Madness.Desktop-arm64.zip`).
2. Unzip it and move **Madness Desktop.app** into `/Applications`. Launched
   from anywhere else, the app offers to move itself there.
3. The first launch is blocked once because the build is unsigned. On macOS 15
   and later, try to open it, then click **Open Anyway** under **System
   Settings → Privacy & Security**; on older macOS, right-click the app →
   **Open** → **Open**. Or clear the quarantine flag:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Madness Desktop.app"
   ```

### Updating

Install the command-line tool from **Madness Desktop → Install Command Line
Tool…** (it links `/usr/local/bin/madhub`), then run:

```sh
madhub upgrade
```

It compares your version with the latest release and, if that's newer,
downloads the zip and swaps the app bundle in place — with `sudo` if
`/Applications` isn't writable.

`madhub` in v0.1.0 and v0.1.1 only recognises a zip ending in
`darwin-arm64.zip`, which v0.1.1 and v0.1.2 lacked; on those versions it
stops with *"no darwin-arm64 asset"*. Update by hand once from the release
page. Builds from here on are packaged under the name every `madhub` finds.

## Building it yourself

You need macOS, Node `24.19.0` (see `.nvmrc`), and Yarn 1 — the full
prerequisites are in [contributing/setup.md](contributing/setup.md).

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
