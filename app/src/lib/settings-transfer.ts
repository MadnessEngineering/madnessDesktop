/**
 * Carry Madness Desktop's settings to another machine as a JSON file (todo
 * a8c1b611, Dan's pick: export/import a file, manual, no sync service).
 *
 * Settings live in this machine's localStorage. Only the keys below travel:
 * preferences a person chose. Never secrets (the Omnispindle key, Copilot
 * provider keys; the MQTT password lives in the keychain and is stripped here
 * anyway, since an old config can still hold it in plain text), never telemetry,
 * tutorial or window state, and never machine-only values (editor and shell
 * paths, zoom, last clone location). Adding a setting to the file is one line
 * in PortableSettingKeys.
 */

export const SettingsFileFormat = 'madness-desktop-settings'
export const SettingsFileVersion = 1

export const PortableSettingKeys: ReadonlyArray<string> = [
  // Madness features
  'auto-ignore-config',
  'chat-history-archive-config',
  'local-ai-config',
  'madness-mqtt-config',
  'madnessRemotes',
  'agent-launch-target',
  'hotkey-overrides',
  'madnessTheme',
  'madnessPersonality',
  'madness-mode-enabled',
  'worktrees-enabled',
  'show-reflog-tab',
  'enable-auto-switch-on-changes',
  'high-signal-notifications-enabled',
  // Terminal
  'terminal-open-on-startup',
  'terminal-font-size',
  'terminal-cursor-blink',
  'terminal-scrollback',
  // Appearance and diffs
  'theme',
  'autoSwitchTheme',
  'underline-links',
  'diff-check-marks-visible',
  'changes-group-by-folder',
  'always-show-worktree-list',
  'show-changes-filter',
  'markdown-preview-enabled',
  'show-side-by-side-diff',
  'hide-whitespace-in-changes-diff',
  'hide-whitespace-in-diff',
  'image-diff-type',
  'commit-spellcheck-enabled',
  'enable-repository-indicators',
  'uncommittedChangesStrategyKind',
  'dateFormat',
  'timeFormat',
  'numberFormat',
  'preferAbsoluteDates',
]

/** Fields taken out of a key's JSON value before it is written to a file. */
const SecretFields: { readonly [key: string]: ReadonlyArray<string> } = {
  'madness-mqtt-config': ['password'],
}

export interface ISettingsFile {
  readonly format: typeof SettingsFileFormat
  readonly version: number
  readonly exportedAt: string
  /** localStorage key → its raw stored string. */
  readonly settings: { readonly [key: string]: string }
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

function withoutSecrets(key: string, raw: string): string {
  const fields = SecretFields[key]
  if (fields === undefined) {
    return raw
  }
  try {
    const value = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return raw
    }
    for (const field of fields) {
      delete value[field]
    }
    return JSON.stringify(value)
  } catch {
    // Not JSON, so it can't hold a secret field.
    return raw
  }
}

/** Every portable setting this machine has stored, ready to write to a file. */
export function collectSettings(
  storage: ReadableStorage,
  now: Date = new Date()
): ISettingsFile {
  const settings: { [key: string]: string } = {}
  for (const key of PortableSettingKeys) {
    const raw = storage.getItem(key)
    if (raw !== null) {
      settings[key] = withoutSecrets(key, raw)
    }
  }
  return {
    format: SettingsFileFormat,
    version: SettingsFileVersion,
    exportedAt: now.toISOString(),
    settings,
  }
}

/** Read a settings file; throws an Error whose message says what's wrong. */
export function parseSettingsFile(text: string): ISettingsFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('That file is not JSON.')
  }
  if (value === null || typeof value !== 'object') {
    throw new Error('That file is not a Madness Desktop settings file.')
  }
  const file = value as Partial<ISettingsFile>
  if (file.format !== SettingsFileFormat) {
    throw new Error('That file is not a Madness Desktop settings file.')
  }
  if (typeof file.version !== 'number' || file.version > SettingsFileVersion) {
    throw new Error(
      'That settings file comes from a newer Madness Desktop. Update this one first.'
    )
  }
  if (
    file.settings === null ||
    typeof file.settings !== 'object' ||
    Array.isArray(file.settings)
  ) {
    throw new Error('That settings file has no settings in it.')
  }
  return file as ISettingsFile
}

export interface IApplyResult {
  /** Keys written to this machine. */
  readonly applied: ReadonlyArray<string>
  /** Keys in the file this version doesn't carry (or whose value isn't text). */
  readonly skipped: ReadonlyArray<string>
}

/**
 * Write a file's settings to this machine. Only portable keys are written, and
 * secret fields are stripped again, so a hand-edited file can't set anything
 * else. The app reads these at startup: restart to see them.
 */
export function applySettings(
  storage: WritableStorage,
  file: ISettingsFile
): IApplyResult {
  const portable = new Set(PortableSettingKeys)
  const applied: string[] = []
  const skipped: string[] = []
  for (const [key, raw] of Object.entries(file.settings)) {
    if (!portable.has(key) || typeof raw !== 'string') {
      skipped.push(key)
      continue
    }
    storage.setItem(key, withoutSecrets(key, raw))
    applied.push(key)
  }
  return { applied, skipped }
}
