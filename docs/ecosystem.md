# The Madness Ecosystem

Madness Desktop is one piece of the madness_interactive workshop. This page
describes how it actually talks to the other pieces today.

## Overview

```text
                    HTTPS + API key
  Madness Desktop ─────────────────────────▶  madnessinteractive.cc/api
   │                                           (Omnispindle API)
   │  · reads and creates todos                 │
   │  · sends git events: commit, push,         └─▶ Inventorium automation bus
   │    pull, branch switch
   │
   │  git hooks (Hook Loadouts)
   └─ mqtt-context ──── mosquitto_pub ────▶  MQTT broker ──▶ your subscribers
```

There are two separate channels:

1. **The Omnispindle API, over HTTPS.** Todos, and git events for
   Inventorium's automation bus. This is the app itself, and it only happens
   once you've connected an Omnispindle account.
2. **MQTT, from hook scripts.** The `mqtt-context` hook publishes each commit
   to a broker of your choosing. Nothing in Omnispindle or Inventorium
   subscribes to those topics today; they're there for your own tools.

## Madness Desktop

The git client. On top of GitHub Desktop it:

- shows your Omnispindle todos in the Changes sidebar, lets you create them,
  and links each to Inventorium (**Open in Inventorium**);
- sends `git-commit`, `git-push`, `git-pull` and `git-branch-switch` events to
  the Omnispindle API's automation endpoint when you do those things in the
  app;
- installs [Hook Loadouts](./hook-loadouts.md), including `mqtt-context` and
  `todo-prefix`.

**Connect it:** **Settings → AI Services → Omnispindle**. Sign in (which
creates an API key for you) or paste an existing key.

The API address is built in: `https://madnessinteractive.cc/api`. Madness
Desktop can't currently be pointed at a different Omnispindle instance.

**Repo:** `MadnessEngineering/madnessDesktop`

## Omnispindle

A Python FastMCP server — the todo, lesson, and context backbone that AI
clients (Claude, Cursor, …) use over MCP. It also serves the HTTP API that
Madness Desktop and Inventorium call.

**Repo:** `MadnessEngineering/Omnispindle`

## Inventorium

The React dashboard at madnessinteractive.cc — todos, projects, lessons, and
the SwarmDesk view — signed in with Auth0. Madness Desktop's git events feed
its automation bus, and todos in the app link to it.

**Repo:** `MadnessEngineering/Inventorium`

## MQTT

A plain Mosquitto broker, if you run one. The `mqtt-context` hook publishes
to:

```text
<prefix>/<device>/claude/git/context   ← latest commit + active todo (retained)
<prefix>/<device>/claude/git/events    ← one message per commit
```

A subscriber on `status/+/claude/git/#` hears every machine. See
[MQTT Integration](./mqtt-integration.md) for the settings and their current
limitations.

## Commits and todos

The `todo-prefix` hook prefixes commit messages with the active todo ID. It
reads that ID from `.git/claude-session-context.json` in the repository —
written by your AI tooling — or from the retained MQTT context message. It
doesn't ask Omnispindle directly.

## Setting up a new machine

1. [Build and install](./installation.md) Madness Desktop.
2. **Settings → AI Services → Omnispindle:** sign in or paste an API key, for
   todos and git events.
3. Optionally, **Settings → MQTT:** broker host and a unique device name.
4. **Repository Settings → Hook Loadouts:** install a loadout in each
   repository you want hooks in.

## Auth

- **GitHub:** a personal access token — see [Authentication](./authentication.md).
- **Omnispindle API:** an API key (or sign-in that creates one), in Settings →
  AI Services.
- **MQTT broker:** Madness Desktop's hooks publish anonymously — see
  [MQTT Integration](./mqtt-integration.md#limitations).
- **Inventorium:** Auth0, in the browser.
