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
| Port | `1883` | The broker's port. |
| Device Name | this machine's hostname | Identifies this machine in the topic path. |
| Topic Prefix | `status` | Root of every topic. |
| Username / Password | empty | For brokers that require a login. |

The **Topic Paths** preview shows what the scripts will use:

```text
<prefix>/<device>/claude/git/context   ← latest commit + active todo (retained context)
<prefix>/<device>/claude/git/events    ← one message per commit
```

**Test Connection** publishes a test message with `mosquitto_pub` using these
settings — credentials included, the same way the hooks send them — and shows
the result.

The password is kept in the system keychain, not in the app's local storage.
For each git command the app runs, it writes the username and password into a
private temporary mosquitto options folder (readable only by you), which the
hook scripts hand to `mosquitto_pub` / `mosquitto_sub` through
`XDG_CONFIG_HOME` for that one call; the folder is deleted when the command
finishes. The password never appears on a command line or in the hooks'
environment.

## How the settings reach the hooks

When Madness Desktop runs a git command — a commit from the app, say — it adds
these variables to the hooks' environment (only while MQTT is enabled):

| Variable | Value |
| --- | --- |
| `DeNa` | Device name |
| `MADNESS_MQTT_HOST` | Broker host |
| `MADNESS_MQTT_PORT` | Broker port |
| `MADNESS_MQTT_USERNAME` | Username, if set |
| `MADNESS_MQTT_CONFIG_DIR` | The private credentials folder, if a username or password is set |
| `MADNESS_GIT_CONTEXT_TOPIC` | Full context topic |
| `MADNESS_GIT_EVENT_TOPIC` | Full events topic |

Commits made **outside** the app (in a terminal) don't get these, so the
scripts fall back to their defaults: host `localhost`, port `1883`, device
`macbook`, prefix `status`, and no login. Export the same variables in your
shell profile if you want terminal commits to publish to the same place.

Repositories whose loadout was installed before a script changed keep their
old copy until you update it — see
[Editing and updating scripts](./hook-loadouts.md#editing-and-updating-scripts).

## Multi-machine setup

Point every machine at the same broker and give each its own Device Name. A
subscriber on `status/+/claude/git/#` then hears every machine.

```text
status/dan-mbp/claude/git/events
status/dan-linux/claude/git/events
```

For a local broker on macOS: `brew install mosquitto && brew services start
mosquitto`.

## Troubleshooting

**Test Connection says `mosquitto_pub not found`** — install the clients:
`brew install mosquitto`.

**Test Connection works, but nothing arrives from commits** — check that the
repository has a loadout with `mqtt-context` installed and enabled
([Hook Loadouts](./hook-loadouts.md)), that you committed from the app (or
exported the variables above), and that the loadout's scripts are up to date
([Hook Loadouts](./hook-loadouts.md#editing-and-updating-scripts)).
