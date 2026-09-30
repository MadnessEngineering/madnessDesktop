# Madness Desktop Documentation

Docs for [Madness Desktop](https://github.com/MadnessEngineering/madnessDesktop):
first the features this fork adds, then the development docs it inherits from
[GitHub Desktop](https://github.com/desktop/desktop).

## Madness Desktop

 - **[Installing](installation.md)** - build it from source, update it, where
    your settings and logs live
 - **[Ecosystem Overview](ecosystem.md)** - how Madness Desktop talks to
    Omnispindle, Inventorium, and MQTT
 - **[Authentication](authentication.md)** - signing in with a personal access
    token
 - **[Submodules, Repositories, and Remotes](submodules-and-repositories.md)** -
    the submodule manager, nested and grouped repositories, the remotes
    manager and branch locks
 - **[Terminal, Local AI, and Claude Code](terminal-and-ai.md)** - the
    integrated terminal and dotfiles panel, local-model commit messages, the
    Claude Code hooks installer
 - **[Interface](interface.md)** - keybindings, themes and UI voice, the
    Reflog tab, changes-list folders, Markdown preview
 - **[Hook Loadouts](hook-loadouts.md)** - bundles of git hook scripts,
    installed and toggled per repository
 - **[MQTT Integration](mqtt-integration.md)** - publishing commits to a broker
    from hooks, and the current limits
 - **[OAuth App Setup](oauth-app-setup.md)** - internal notes for registering
    our own GitHub OAuth app (not done yet)
 - **[Upstream Sync](process/upstream-sync.md)** - how we merge GitHub Desktop
    into the fork, and what always conflicts

## Inherited from GitHub Desktop

These describe GitHub Desktop's code, tooling, and team. Most of the code
guidance applies here too; the process pages describe GitHub's own team and
repository, not this fork.

### Contributing

 - **[Development Environment Setup](contributing/setup.md)** - getting the
    app building and running
 - **[Engineering Values](contributing/engineering-values.md)** - high-level
    engineering values
 - **[Style Guide](contributing/styleguide.md)** - notes on the coding style
 - **[Tooling](contributing/tooling.md)** - editor enhancements
 - **[Troubleshooting](contributing/troubleshooting.md)** - known environment
    issues

### Technical

 - **[Dialogs](technical/dialogs.md)** - the dialog component API
 - **[Windows menu bar](technical/windows-menu-bar.md)** - the custom menu
    components used on Windows
 - **[Developer OAuth App](technical/oauth.md)** - the bundled developer OAuth
    app
 - **[Building and Packaging Desktop](technical/packaging.md)** - how Desktop
    is packaged
 - **[Automatic Git Proxy support](technical/proxies.md)** - Git automatic
    proxy support and troubleshooting

### GitHub Desktop's process

 - **[Release Planning](process/release-planning.md)**
 - **[Issue Triage](process/issue-triage.md)**
 - **[Pull Requests](process/pull-requests.md)**
