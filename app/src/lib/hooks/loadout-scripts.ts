import { HookScript } from './loadout-types'

// ---------------------------------------------------------------------------
// post-commit: MQTT context publisher
// ---------------------------------------------------------------------------
const mqttContext: HookScript = {
  id: 'mqtt-context',
  name: 'MQTT Context Publisher',
  description:
    'Publishes commit context to MQTT broker for cross-tool awareness',
  hookType: 'post-commit',
  script: `#!/usr/bin/env bash
set -euo pipefail

DEVICE_NAME="\${DeNa:-macbook}"
MQTT_HOST="\${MADNESS_MQTT_HOST:-localhost}"
MQTT_PORT="\${MADNESS_MQTT_PORT:-1883}"
GIT_CONTEXT_TOPIC="\${MADNESS_GIT_CONTEXT_TOPIC:-status/\${DEVICE_NAME}/claude/git/context}"
GIT_EVENT_TOPIC="\${MADNESS_GIT_EVENT_TOPIC:-status/\${DEVICE_NAME}/claude/git/events}"
GIT_CONTEXT_FILE="$(git rev-parse --git-dir 2>/dev/null)/claude-session-context.json"

COMMIT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
BRANCH_NAME="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
COMMIT_SUBJECT="$(git log -1 --pretty=%s 2>/dev/null || true)"
NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

ACTIVE_TODO_ID=""
TODO_SHORT_ID=""
if [[ -f "$GIT_CONTEXT_FILE" ]]; then
  ACTIVE_TODO_ID="$(python3 - "$GIT_CONTEXT_FILE" <<'PY'
import json, pathlib, sys
try:
    data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
except Exception:
    print(""); raise SystemExit(0)
print(str(data.get("active_todo_id") or "").strip())
PY
)"
  TODO_SHORT_ID="\${ACTIVE_TODO_ID%%-*}"
fi

python3 - "$GIT_CONTEXT_TOPIC" "$GIT_EVENT_TOPIC" "$COMMIT_SHA" "$BRANCH_NAME" "$COMMIT_SUBJECT" "$ACTIVE_TODO_ID" "$TODO_SHORT_ID" "$NOW_UTC" "$MQTT_HOST" "$MQTT_PORT" <<'PY'
import json, os, subprocess, sys

context_topic, event_topic, sha, branch, subject, todo_id, todo_short, updated, mqtt_host, mqtt_port = sys.argv[1:]

# Broker credentials, when Madness Desktop has any, come from a private
# mosquitto options folder rather than the command line.
client_env = dict(os.environ)
if os.environ.get("MADNESS_MQTT_CONFIG_DIR"):
    client_env["XDG_CONFIG_HOME"] = os.environ["MADNESS_MQTT_CONFIG_DIR"]

context_payload = {
    "updated_at": updated, "state": "active", "branch": branch,
    "last_commit_sha": sha, "last_commit_subject": subject,
    "active_todo_id": todo_id, "todo_short_id": todo_short,
    "commit_prefix": todo_id or todo_short,
}
event_payload = {
    "updated_at": updated, "event": "post_commit", "branch": branch,
    "commit_sha": sha, "commit_subject": subject, "active_todo_id": todo_id,
}

for topic, payload, retained in (
    (context_topic, context_payload, True),
    (event_topic, event_payload, False),
):
    try:
        cmd = ["mosquitto_pub", "-h", mqtt_host, "-p", mqtt_port, "-t", topic, "-m", json.dumps(payload)]
        if retained:
            cmd.append("-r")
        subprocess.run(cmd, capture_output=True, timeout=3, text=True, env=client_env)
    except Exception:
        pass
PY
`,
}

// ---------------------------------------------------------------------------
// prepare-commit-msg: todo prefix injector
// ---------------------------------------------------------------------------
const todoPrefix: HookScript = {
  id: 'todo-prefix',
  name: 'Todo Prefix Injector',
  description:
    'Auto-prepends active todo UUID to commit messages from context file or MQTT',
  hookType: 'prepare-commit-msg',
  script: `#!/usr/bin/env bash
set -euo pipefail

MSG_FILE="\${1:-}"
COMMIT_SOURCE="\${2:-}"

[[ -z "$MSG_FILE" || ! -f "$MSG_FILE" ]] && exit 0

case "$COMMIT_SOURCE" in
  merge|squash|commit) exit 0 ;;
esac

DEVICE_NAME="\${DeNa:-macbook}"
MQTT_HOST="\${MADNESS_MQTT_HOST:-localhost}"
MQTT_PORT="\${MADNESS_MQTT_PORT:-1883}"
GIT_CONTEXT_TOPIC="\${MADNESS_GIT_CONTEXT_TOPIC:-status/\${DEVICE_NAME}/claude/git/context}"
GIT_CONTEXT_FILE="$(git rev-parse --git-dir 2>/dev/null)/claude-session-context.json"

# Broker credentials, when Madness Desktop has any, come from a private
# mosquitto options folder rather than the command line.
mqtt_sub() {
  if [[ -n "\${MADNESS_MQTT_CONFIG_DIR:-}" ]]; then
    XDG_CONFIG_HOME="$MADNESS_MQTT_CONFIG_DIR" mosquitto_sub "$@"
  else
    mosquitto_sub "$@"
  fi
}

get_prefix_from_json() {
  local payload="$1"
  python3 - "$payload" <<'PY'
import json, re, sys
raw = sys.argv[1]
try:
    data = json.loads(raw)
except Exception:
    print(""); raise SystemExit(0)
prefix = str(data.get("commit_prefix") or data.get("active_todo_id") or data.get("todo_short_id") or "").strip()
if not prefix:
    todo_id = str(data.get("active_todo_id") or "").strip()
    if todo_id:
        prefix = todo_id
if prefix and re.fullmatch(r"[A-Za-z0-9_-]{8,}", prefix):
    print(prefix)
else:
    print("")
PY
}

PREFIX=""
if [[ -f "$GIT_CONTEXT_FILE" ]]; then
  PREFIX="$(get_prefix_from_json "$(python3 -c "import pathlib; print(pathlib.Path('$GIT_CONTEXT_FILE').read_text(encoding='utf-8'))" 2>/dev/null || true)")"
fi

if [[ -z "$PREFIX" ]]; then
  RETAINED_PAYLOAD="$(mqtt_sub -h "$MQTT_HOST" -p "$MQTT_PORT" -t "$GIT_CONTEXT_TOPIC" -C 1 -W 1 2>/dev/null || true)"
  [[ -n "$RETAINED_PAYLOAD" ]] && PREFIX="$(get_prefix_from_json "$RETAINED_PAYLOAD")"
fi

[[ -z "$PREFIX" ]] && exit 0

CURRENT_SUBJECT="$(python3 - "$MSG_FILE" <<'PY'
import pathlib, sys
for line in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    s = line.strip()
    if s and not s.startswith("#"):
        print(s); break
PY
)"

[[ -z "$CURRENT_SUBJECT" ]] && exit 0
[[ "$CURRENT_SUBJECT" == "$PREFIX"* ]] && exit 0

python3 - "$MSG_FILE" "$PREFIX" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
prefix = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines()
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped and not stripped.startswith("#"):
        lines[i] = f"{prefix} {stripped}"
        break
path.write_text("\\n".join(lines) + "\\n", encoding="utf-8")
PY
`,
}

// ---------------------------------------------------------------------------
// post-checkout: auto-pull on main/master
// ---------------------------------------------------------------------------
const autoPull: HookScript = {
  id: 'auto-pull',
  name: 'Auto-Pull on Main',
  description: 'Fast-forward pulls when switching to main or master branch',
  hookType: 'post-checkout',
  script: `#!/usr/bin/env bash
# Args: $1=prev HEAD, $2=new HEAD, $3=1(branch switch) or 0(file checkout)
BRANCH_SWITCH=$3
[[ "$BRANCH_SWITCH" != "1" ]] && exit 0

CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [[ "$CURRENT" = "main" || "$CURRENT" = "master" ]]; then
    echo "[post-checkout] On \${CURRENT} — pulling latest..."
    git pull --ff-only 2>&1 || echo "[post-checkout] ff-only pull failed (diverged?), skipping"
fi
`,
}

// ---------------------------------------------------------------------------
// pre-commit: secret scanner
// ---------------------------------------------------------------------------
const secretScan: HookScript = {
  id: 'secret-scan',
  name: 'Secret Scanner',
  description: 'Blocks commits containing SSH keys or private key material',
  hookType: 'pre-commit',
  script: `#!/usr/bin/env bash
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

FORBIDDEN_PATTERNS=(
    "ssh-rsa AAAA[0-9A-Za-z+/]+[=]{0,3}"
    "-----BEGIN RSA PRIVATE KEY-----"
    "-----BEGIN EC PRIVATE KEY-----"
    "-----BEGIN OPENSSH PRIVATE KEY-----"
)

found_forbidden=0

for FILE in $STAGED_FILES; do
    [[ "$FILE" == .githooks/* ]] && continue
    for PATTERN in "\${FORBIDDEN_PATTERNS[@]}"; do
        if grep -qE -e "$PATTERN" "$FILE" 2>/dev/null; then
            echo "DANGER: Forbidden pattern found in '$FILE'."
            echo "   Please remove the key before committing."
            found_forbidden=1
        fi
    done
done

if [ "$found_forbidden" -ne 0 ]; then
    echo "   Commit blocked due to sensitive data."
    exit 1
fi
exit 0
`,
}

// ---------------------------------------------------------------------------
// post-commit: auto-push
// ---------------------------------------------------------------------------
const autoPush: HookScript = {
  id: 'auto-push',
  name: 'Auto-Push',
  description: 'Pushes all branches after each commit',
  hookType: 'post-commit',
  script: `#!/usr/bin/env bash
git push --all 2>&1 || echo "[auto-push] Push failed, continuing"
`,
}

// ---------------------------------------------------------------------------
// post-commit: build-dev trigger
// ---------------------------------------------------------------------------
const buildDev: HookScript = {
  id: 'build-dev',
  name: 'Dev Build Trigger',
  description: 'Runs yarn build:dev in background after commit',
  hookType: 'post-commit',
  script: `#!/usr/bin/env bash
echo "Starting yarn build:dev in background..."
(cd "$(git rev-parse --show-toplevel)" && yarn build:dev &) 2>&1 | head -5 &
`,
}

// ---------------------------------------------------------------------------
// pre-push: remote-guard
// ---------------------------------------------------------------------------
const remoteGuard: HookScript = {
  id: 'remote-guard',
  name: 'Remote Guard',
  description:
    'Blocks pushes of branches locked to other remotes (or to no remote at all)',
  hookType: 'pre-push',
  script: `#!/usr/bin/env bash
# remote-guard: refuse pushes that violate a branch's madnessRemotes policy.
#
# The policy lives in the repository's own config as
# branch.<name>.madnessRemotes and is written by Madness Desktop. Values are
# "none", "all", or a space separated list of permitted remote names. A branch
# with no policy is not restricted.
#
# Note that git runs this once for the whole push, so a batch such as
# \`git push --all\` is rejected in full if any single branch in it is blocked.
# That is deliberate: a partial push is a worse outcome than a refused one.
remote_name="$1"
blocked=0

while read -r local_ref _ _ _; do
    # Deletions arrive as "(delete)"; removing a ref can't leak anything.
    [ -z "$local_ref" ] && continue
    [ "$local_ref" = "(delete)" ] && continue

    case "$local_ref" in
        refs/heads/*) branch="\${local_ref#refs/heads/}" ;;
        *) continue ;;
    esac

    policy=$(git config --local --get "branch.$branch.madnessRemotes" 2>/dev/null) || continue
    [ -z "$policy" ] && continue

    case "$policy" in
        all|ALL|All) continue ;;
        none|NONE|None)
            echo "MADNESS-REMOTE-BLOCKED: '$branch' is local only and must not be pushed."
            blocked=1
            continue
            ;;
    esac

    if ! printf '%s\\n' $policy | grep -qxF "$remote_name"; then
        echo "MADNESS-REMOTE-BLOCKED: '$branch' may only be pushed to: $policy (tried '$remote_name')."
        blocked=1
    fi
done

if [ "$blocked" -ne 0 ]; then
    echo "Change the branch's remote policy in Madness Desktop, or run:"
    echo "  git config --local --unset branch.<branch>.madnessRemotes"
    exit 1
fi
exit 0
`,
}

/** All bundled hook scripts available for loadouts. */
export const BUILTIN_SCRIPTS: ReadonlyArray<HookScript> = [
  mqttContext,
  todoPrefix,
  autoPull,
  secretScan,
  autoPush,
  buildDev,
  remoteGuard,
]

/** Look up a builtin script by ID. */
export function getBuiltinScript(id: string): HookScript | undefined {
  return BUILTIN_SCRIPTS.find(s => s.id === id)
}
