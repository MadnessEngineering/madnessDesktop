/**
 * Configuration for the background chat history archiver.
 *
 * When enabled, the watcher periodically scans tracked repositories for
 * AI conversation history directories (.specstory/history, .claude/, etc.)
 * and offers to centralize them via move + symlink into a single archive repo.
 */

export interface IChatHistoryArchiveConfig {
  readonly enabled: boolean
  /** Absolute path to the archive repository root. */
  readonly archivePath: string
  /** Directories to watch for inside each tracked repo. */
  readonly watchDirs: ReadonlyArray<string>
  /** Scan interval in milliseconds. */
  readonly intervalMs: number
  /** Auto-commit archived history to the archive repo. */
  readonly autoCommit: boolean
  /** Auto-push after commit. */
  readonly autoPush: boolean
}

export const ChatHistoryArchiveConfigKey = 'chat-history-archive-config'

/**
 * A single archive operation log entry, persisted to localStorage.
 */
export interface IChatHistoryArchiveLogEntry {
  readonly timestamp: number
  readonly repos: ReadonlyArray<string>
  readonly archived: number
  readonly failed: number
  readonly error?: string
}

export const ChatHistoryArchiveLogKey = 'chat-history-archive-log'
export const MaxArchiveLogEntries = 50

export const DefaultChatHistoryArchiveConfig: IChatHistoryArchiveConfig = {
  enabled: false,
  // No default: archiving moves folders, so the destination must be chosen.
  archivePath: '',
  watchDirs: ['.specstory/history', '.claude'],
  intervalMs: 5 * 60 * 1000, // 5 minutes
  autoCommit: true,
  autoPush: true,
}
