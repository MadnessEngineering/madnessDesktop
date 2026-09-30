# MQTT Integration

Madness Desktop can tell the rest of the workshop about your commits over
MQTT, so other machines and tools (Omnispindle, Inventorium, your own scripts)
see git activity as it happens.

The app doesn't publish anything itself. The publishing is done by the
`mqtt-context` hook script from a [hook loadout](./hook-loadouts.md); the MQTT
settings here tell those scripts where to send it.

```text
commit → mqtt-context hook → mosquitto_pub → broker → any subscriber
```

## Settings

Open **Settings → MQTT**.

| Field | Default | What it does |
| --- | --- | --- |
| Enable MQTT integration | on | When off, the settings below aren't passed to hooks. |
| Broker Host | `localhost` | Where the hook scripts publish. |
| Port | `1883` | See the note under [Limitations](#limitations). |
| Device Name | this machine's hostname | Identifies this machine in the topic path. |
| Topic Prefix | `status` | Root of every topic. |
| Username / Password | empty | Used by **Test Connection**; see [Limitations](#limitations). |

The **Topic Paths** preview shows what the scripts will use:

```text
<prefix>/<device>/claude/git/context   ← latest commit + active todo (retained context)
<prefix>/<device>/claude/git/events    ← one message per commit
```

**Test Connection** publishes a test message with `mosquitto_pub` using these
settings and shows the result.

The password is kept in the system keychain, not in the app's local storage,
and is never handed to hook scripts.

## How the settings reach the hooks

When Madness Desktop runs a git command — a commit from the app, say — it adds
these variables to the hooks' environment (only while MQTT is enabled):

| Variable | Value |
| --- | --- |
| `DeNa` | Device name |
| `MADNESS_MQTT_HOST` | Broker host |
| `MADNESS_MQTT_PORT` | Broker port |
| `MADNESS_MQTT_USERNAME` | Username, if set |
| `MADNESS_GIT_CONTEXT_TOPIC` | Full context topic |
| `MADNESS_GIT_EVENT_TOPIC` | Full events topic |

Commits made **outside** the app (in a terminal) don't get these, so the
scripts fall back to their defaults: host `localhost`, device `macbook`,
prefix `status`. Export the same variables in your shell profile if you want
terminal commits to publish to the same place.

## Multi-machine setup

Point every machine at the same broker and give each its own Device Name. A
subscriber on `status/+/claude/git/#` then hears every machine.

```text
status/dan-mbp/claude/git/events
status/dan-linux/claude/git/events
```

For a local broker on macOS: `brew install mosquitto && brew services start
mosquitto`.

## Limitations

- **Port:** the hook scripts don't pass the port to `mosquitto_pub`, so they
  always use the default, `1883`, whatever the Port field says.
- **Authentication:** the hook scripts don't send a username or password, so
  publishing from hooks only works with a broker that allows anonymous
  clients. Username and password only apply to Test Connection.

## Troubleshooting

**Test Connection says `mosquitto_pub not found`** — install the clients:
`brew install mosquitto`.

**Test Connection works, but nothing arrives from commits** — check that the
repository has a loadout with `mqtt-context` installed and enabled
([Hook Loadouts](./hook-loadouts.md)), that you committed from the app (or
exported the variables above), and the limitations above.
