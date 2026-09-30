import { hostname } from 'os'
import { join } from 'path'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { TokenStore } from '../stores/token-store'

export interface IMqttConfig {
  readonly enabled: boolean
  readonly host: string
  readonly port: number
  readonly deviceName: string
  readonly topicPrefix: string
  readonly username: string
  readonly password: string
}

const storageKey = 'madness-mqtt-config'

const MQTT_KEYTAR_KEY = __DEV__
  ? 'Madness Desktop Dev - MQTT'
  : 'Madness Desktop - MQTT'
const MQTT_KEYTAR_ACCOUNT = 'mqtt-password'

export const DefaultMqttConfig: IMqttConfig = {
  enabled: true,
  host: 'localhost',
  port: 1883,
  deviceName: hostname(),
  topicPrefix: 'status',
  username: '',
  password: '',
}

export function getMqttConfig(): IMqttConfig {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return DefaultMqttConfig
    }
    // Password is never persisted in localStorage — always empty here.
    // Use getMqttPassword() for the real value.
    const stored = JSON.parse(raw)
    return { ...DefaultMqttConfig, ...stored, password: '' }
  } catch {
    return DefaultMqttConfig
  }
}

export function saveMqttConfig(config: IMqttConfig): void {
  try {
    // Strip password before persisting — stored in keytar instead.
    const { password: _pw, ...rest } = config
    localStorage.setItem(storageKey, JSON.stringify(rest))
  } catch {
    // localStorage unavailable
  }
}

export function getMqttPassword(): Promise<string | null> {
  return TokenStore.getItem(MQTT_KEYTAR_KEY, MQTT_KEYTAR_ACCOUNT)
}

export function saveMqttPassword(password: string): Promise<void> {
  if (!password) {
    return TokenStore.deleteItem(MQTT_KEYTAR_KEY, MQTT_KEYTAR_ACCOUNT).then(
      () => {}
    )
  }
  return TokenStore.setItem(MQTT_KEYTAR_KEY, MQTT_KEYTAR_ACCOUNT, password)
}

export async function migrateMqttPasswordIfNeeded(): Promise<string | null> {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return TokenStore.getItem(MQTT_KEYTAR_KEY, MQTT_KEYTAR_ACCOUNT)
    }
    const stored = JSON.parse(raw)
    if (stored.password) {
      // Legacy plaintext password in localStorage — move to keytar.
      await TokenStore.setItem(
        MQTT_KEYTAR_KEY,
        MQTT_KEYTAR_ACCOUNT,
        stored.password
      )
      delete stored.password
      localStorage.setItem(storageKey, JSON.stringify(stored))
      return stored.password as string
    }
  } catch {
    // fall through
  }
  return TokenStore.getItem(MQTT_KEYTAR_KEY, MQTT_KEYTAR_ACCOUNT)
}

/**
 * Convert MQTT config to environment variables that hook scripts expect.
 * These match the env vars used by the bundled hook scripts
 * (mqtt-context post-commit, todo-prefix prepare-commit-msg).
 */
export function mqttConfigToEnv(config: IMqttConfig): Record<string, string> {
  if (!config.enabled) {
    return {}
  }

  const env: Record<string, string> = {
    DeNa: config.deviceName,
    MADNESS_MQTT_HOST: config.host,
    MADNESS_MQTT_PORT: String(config.port),
    MADNESS_GIT_CONTEXT_TOPIC: `${config.topicPrefix}/${config.deviceName}/claude/git/context`,
    MADNESS_GIT_EVENT_TOPIC: `${config.topicPrefix}/${config.deviceName}/claude/git/events`,
  }

  if (config.username) {
    env.MADNESS_MQTT_USERNAME = config.username
  }
  // Password is NOT exposed in hook env — kept in keytar, never spread to
  // git repo hooks or process.env where 3rd-party scripts can read it.

  return env
}

/**
 * Compute the full topic paths for display in the UI.
 */
export function getTopicPaths(config: IMqttConfig): {
  context: string
  events: string
} {
  return {
    context: `${config.topicPrefix}/${config.deviceName}/claude/git/context`,
    events: `${config.topicPrefix}/${config.deviceName}/claude/git/events`,
  }
}

/**
 * The environment variable naming a private folder of mosquitto client
 * options (see `writeMosquittoClientConfig`). Hook scripts point
 * `XDG_CONFIG_HOME` at it for the mosquitto command alone.
 */
export const MosquittoConfigDirEnv = 'MADNESS_MQTT_CONFIG_DIR'

/**
 * Write broker credentials where `mosquitto_pub` and `mosquitto_sub` pick them
 * up without anything on the command line: they read default options, one
 * `-option value` per line, from `$XDG_CONFIG_HOME/mosquitto_pub` (and
 * `…/mosquitto_sub`). Running a client with `XDG_CONFIG_HOME=<dir>` sends the
 * credentials while keeping the password out of argv, where any local user
 * could read it with `ps`.
 *
 * `dir` is created owner-only (0700), the files 0600. Returns false — and
 * writes nothing — when there are no credentials, or when a value contains a
 * line break, which would smuggle extra options into the file.
 */
export async function writeMosquittoClientConfig(
  dir: string,
  username: string,
  password: string
): Promise<boolean> {
  if (!username && !password) {
    return false
  }
  if (/[\r\n]/.test(username) || /[\r\n]/.test(password)) {
    log.warn('MQTT: credentials contain a line break; not passing them on')
    return false
  }

  const lines = [
    ...(username ? [`-u ${username}`] : []),
    ...(password ? [`-P ${password}`] : []),
  ]
  const contents = lines.join('\n') + '\n'

  await mkdir(dir, { recursive: true, mode: 0o700 })
  // mkdir leaves an existing folder's mode alone.
  await chmod(dir, 0o700)
  for (const client of ['mosquitto_pub', 'mosquitto_sub']) {
    const file = join(dir, client)
    await writeFile(file, contents, { mode: 0o600 })
    // writeFile only applies the mode when it creates the file.
    await chmod(file, 0o600)
  }
  return true
}
