/** Hook types supported by the loadout system. */
export type GitHookType =
  | 'pre-commit'
  | 'prepare-commit-msg'
  | 'post-commit'
  | 'post-checkout'
  | 'pre-push'

/** A single injectable hook script that can be part of a loadout. */
export interface HookScript {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly hookType: GitHookType
  readonly script: string
}

/** A named collection of hook scripts that can be installed together. */
export interface HookLoadout {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly scriptIds: ReadonlyArray<string>
  readonly builtin: boolean
}

/** Tracks which loadout is installed in a repository and per-script overrides. */
export interface LoadoutInstallation {
  readonly repoPath: string
  readonly loadoutId: string
  readonly installedAt: string
  readonly disabledScripts: ReadonlyArray<string>
  /**
   * sha256 of each script as Madness Desktop last wrote it, by script id.
   * Lets the settings tell a stale copy (safe to update) from one the user
   * edited. Absent on installations made before this was recorded.
   */
  readonly installedHashes?: Readonly<Record<string, string>>
}

/** How an installed script compares with the built-in version. */
export type InstalledScriptStatus = 'current' | 'outdated' | 'customized'
