# Madness Desktop

A [GitHub Desktop](https://github.com/desktop/desktop) fork wired into the **madness_interactive** workshop — multi-machine git coordination, composable git hooks, and live workshop todos, on top of the familiar Desktop git client. Built with [Electron](https://www.electronjs.org/), [TypeScript](https://www.typescriptlang.org), and [React](https://reactjs.org/).

> **Early build.** The only thing we ship is an **unsigned macOS build for Apple Silicon (arm64)** — no Intel, Windows, or Linux release yet. Releases are cut by hand and trail `main`, sometimes by a lot: newer features (the exploded view below among them) may only be in a [source build](#building-it-yourself) for now.

![Madness Desktop's exploded view: the repository drawn as an isometric assembly of lettered parts, its submodule a dashed crate, with History paint marking the busiest parts in amber](docs/assets/exploded-view.png)

## Where can I get it?

1. Open the [latest release](https://github.com/MadnessEngineering/madnessDesktop/releases/latest) and download its `arm64` zip — `MadnessDesktop-<version>-darwin-arm64.zip` (v0.1.1 and v0.1.2 named it `Madness.Desktop-arm64.zip`).
2. Unzip it and move **Madness Desktop.app** into `/Applications`. (Launched from anywhere else, the app offers to move itself there — your settings live in `~/Library/Application Support/Madness Desktop`, not in the app, so moving or replacing it keeps them.)
3. First launch only: the build is unsigned, so macOS blocks it once. On macOS 15 and later, open it, then go to **System Settings → Privacy & Security** and click **Open Anyway**; on older macOS, **right-click the app → Open → Open**. Either way it opens normally after that. Or clear the quarantine flag yourself:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Madness Desktop.app"
   ```

## Keeping it updated

Install the command-line tool once (**Madness Desktop → Install Command Line Tool…**), then self-update from the terminal:

```sh
madhub upgrade
```

It checks the latest GitHub release and, if it's newer than what you have, downloads it and swaps the app in place (using `sudo` if `/Applications` isn't writable).

> **On v0.1.0 or v0.1.1?** Their `madhub upgrade` looks for a zip ending in `darwin-arm64.zip`, and v0.1.1–v0.1.2 were published without that suffix, so it stops with *"no darwin-arm64 asset"*. Download the zip by hand once (steps above); builds from here on are packaged under the name every `madhub` finds.

## Building it yourself

For everything on `main`, build from source (macOS, Node `24.19.0` per `.nvmrc`, Yarn 1 — full prerequisites in [`docs/contributing/setup.md`](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/contributing/setup.md)):

```sh
git clone https://github.com/MadnessEngineering/madnessDesktop.git
cd madnessDesktop
yarn
make install      # production build, quits the running app, installs into /Applications
```

After a pull, `make install` again rebuilds and swaps it in; `make install-app` just re-installs the last build and refreshes the `madhub` link.

## What makes it different?

Everything GitHub Desktop does, plus workshop coordination:

- **[Hook Loadouts](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/hook-loadouts.md)** — install and toggle bundles of git-hook scripts per repository from the UI. A thin `.d/` dispatcher lets multiple scripts stack on the same hook without clobbering each other, and recent hook runs show up in a log in the Changes sidebar. Presets: `mad-standard`, `deploy-enabled`, `desktop-dev`, `minimal`.
- **[MQTT integration](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/mqtt-integration.md)** — publish commit context and events to a shared broker. Every machine on the network sees real-time git activity from every other machine.
- **[Omnispindle todos](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/ecosystem.md)** — a live todo list from the Omnispindle MCP server in the Changes sidebar, plus a `todo-prefix` hook that stamps the active todo ID into your commit message.
- **Exploded view** — when a repository has no local changes, flip the page to an instruction-manual drawing of it: every folder a lettered part sized by weight, submodules as dashed crates, tool dot-folders set aside, and a materials list underneath. Step into a folder to take it apart too, or into a submodule to switch the app to it — and back out again from the breadcrumb. **Paint** marks where the work is, one amber side per part: your uncommitted changes (also reachable from the diff header while you have them), the last 100 commits' history, or submodules drifting off their pins.
- **Subrepo tooling** — submodules nest under their monorepo as collapsible folders, un-added submodules appear as "ghost" rows with one-click **Add**, submodule commit history shows up in diffs, and push/pull steps through each submodule before the parent.

  ![A submodule pointer change in the parent repository, listing the commits it brings in, with Sync and Rollback](docs/assets/submodule-changes.png)
- **Madness Themes** — a pack of custom color schemes with a picker in **Preferences → Appearance** and hotkeys to cycle through them.
- **Auto-switch monitor** — automatically focuses whichever repository just picked up new changes.
- **[`madhub` CLI](#the-madhub-cli)** — open, clone, group, run submodule ops, and self-update from the terminal.
- **[Token sign-in](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/authentication.md)** — sign in with a Personal Access Token, or skip in-app sign-in entirely and let git use your system credential helper. (The GitHub OAuth browser flow can't redirect back to a fork, so these are the two working paths.)

## The `madhub` CLI

Install it from the app menu: **Madness Desktop → Install Command Line Tool…** (symlinks `/usr/local/bin/madhub`).

| Command | What it does |
|---------|--------------|
| `madhub` | Open the current directory |
| `madhub open [path]` | Open the provided path |
| `madhub add [path] -g <group>` | Add the repo to the list and file it under `<group>` (created if new) |
| `madhub clone [-b branch] [-g group] <url>` | Clone a repo by URL or `owner/name` (e.g. `torvalds/linux`), optionally checking out a branch and filing it under a group |
| `madhub sub <op> [path] [sub]` | Submodule op: `init`, `pull`, `push` (repo-wide, or one `<sub>`); `sync`, `rollback` (need `<sub>`) |
| `madhub foreach <cmd> [-r] [path]` | Run a shell command across every submodule and print the combined output |
| `madhub group <ls\|create\|rm> [name]` | List, create, or remove custom groups |
| `madhub fav [path]` | Toggle the repo as a favorite |
| `madhub upgrade` | Download and install the latest release |

## The Madness ecosystem

Madness Desktop is one node in a larger workshop coordination system — git events flow over MQTT to the [Omnispindle](https://github.com/MadnessEngineering/Omnispindle) MCP server and the [Inventorium](https://github.com/MadnessEngineering/Inventorium) dashboard. See [docs/ecosystem.md](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/ecosystem.md) for how the pieces fit together and how to bring a new machine onto the broker.

## Documentation

- [Installation & data directories](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/installation.md)
- [Authentication](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/authentication.md)
- [Hook Loadouts](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/hook-loadouts.md)
- [MQTT integration](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/mqtt-integration.md)
- [The Madness ecosystem](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/ecosystem.md)
- [Known issues](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/known-issues.md)
- [All docs](https://github.com/MadnessEngineering/madnessDesktop/tree/HEAD/docs)

## Building & contributing

To set up a development environment, see [`docs/contributing/setup.md`](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/docs/contributing/setup.md). The [`.github/CONTRIBUTING.md`](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/.github/CONTRIBUTING.md) guide covers the source layout, and the [docs](https://github.com/MadnessEngineering/madnessDesktop/tree/HEAD/docs) folder has the rest.

Found a bug or want to suggest something? Open an [issue](https://github.com/MadnessEngineering/madnessDesktop/issues/new/choose). The [Code of Conduct](https://github.com/MadnessEngineering/madnessDesktop/blob/HEAD/CODE_OF_CONDUCT.md) applies to all project interactions.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo designs. GitHub reserves all trademark and copyright rights in and to all GitHub trademarks. GitHub's logos include, for instance, the stylized Invertocat designs that include "logo" in the file title in the following folder: [logos](https://github.com/MadnessEngineering/madnessDesktop/tree/HEAD/app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's Trademarks or registered Trademarks. When using GitHub's logos, be sure to follow the GitHub [logo guidelines](https://github.com/logos).
