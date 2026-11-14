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
  /** Commit message; `{patterns}` is replaced with the appended rules. */
  readonly commitMessage: string
}

export const AutoIgnoreConfigKey = 'auto-ignore-config'

export const DefaultAutoIgnoreConfig: IAutoIgnoreConfig = {
  enabled: false,
  patterns: ['.claude_temp/'],
  commitMessage: 'chore(gitignore): auto-ignore {patterns}',
}
