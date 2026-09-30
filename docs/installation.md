# Installing Madness Desktop

You build Madness Desktop from source — there's no maintained download. The
[Releases](https://github.com/MadnessEngineering/madnessDesktop/releases) page
has a few old builds, but they're months behind `main`.

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

## Updating

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
