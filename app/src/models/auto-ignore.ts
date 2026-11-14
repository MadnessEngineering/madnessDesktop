/**
 * Configuration for "standard practice" ignore patterns.
 *
 * When enabled, any repository whose only changes are untracked files
 * matching one of these patterns gets the pattern appended to its root
 * .gitignore, and that .gitignore change is committed on its own.
 */

export interface IAutoIgnoreConfig {
  readonly enabled: boolean
  /**
   * Single-segment gitignore patterns, e.g. `.claude_temp/` or `*.log`.
   * See `isValidStandardPattern` for what's accepted.
   */
  readonly patterns: ReadonlyArray<string>
  /**
   * Commit the .gitignore change on its own. When off, the rule is appended
   * and left in the working directory for a human to commit.
   */
  readonly autoCommit: boolean
  /** Commit message; `{patterns}` is replaced with the appended rules. */
  readonly commitMessage: string
}

export const AutoIgnoreConfigKey = 'auto-ignore-config'

export const DefaultAutoIgnoreConfig: IAutoIgnoreConfig = {
  enabled: false,
  patterns: ['.claude_temp/'],
  autoCommit: true,
  commitMessage: 'chore(gitignore): auto-ignore {patterns}',
}

export type AutoIgnoreOutcome =
  /** Rule appended and .gitignore committed. */
  | 'committed'
  /** Rule appended, auto-commit off, left for a human. */
  | 'appended'
  /** Matched, but nothing was done (rule already present, extra changes). */
  | 'skipped'
  | 'failed'

/** One auto-ignore run, persisted to localStorage for the settings tab. */
export interface IAutoIgnoreLogEntry {
  readonly timestamp: number
  readonly repository: string
  readonly patterns: ReadonlyArray<string>
  readonly outcome: AutoIgnoreOutcome
  readonly sha?: string
  readonly detail?: string
}

export const AutoIgnoreLogKey = 'auto-ignore-log'
export const MaxAutoIgnoreLogEntries = 30
