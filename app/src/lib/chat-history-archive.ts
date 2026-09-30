import * as Path from 'path'
import * as Fs from 'fs'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  symlink,
  unlink,
} from 'fs/promises'
import { pathExists } from './path-exists'
import { exec as git } from 'dugite'
import {
  IChatHistoryArchiveConfig,
  IChatHistoryArchiveLogEntry,
  ChatHistoryArchiveLogKey,
  MaxArchiveLogEntries,
} from '../models/chat-history-archive'
import { Repository } from '../models/repository'

export interface IArchiveCandidate {
  readonly repository: Repository
  /** The relative watchDir that was found (e.g. '.specstory/history'). */
  readonly watchDir: string
  /** Full path to the source directory in the repo. */
  readonly sourcePath: string
}

export interface IArchiveResult {
  readonly candidate: IArchiveCandidate
  readonly destPath: string
  readonly success: boolean
  readonly error?: string
}

/**
 * Scans a list of repositories for un-archived AI chat history directories.
 * A directory is considered un-archived if it exists and is NOT already a symlink.
 */
export function findArchiveCandidates(
  repositories: ReadonlyArray<Repository>,
  config: IChatHistoryArchiveConfig
): ReadonlyArray<IArchiveCandidate> {
  const candidates: IArchiveCandidate[] = []

  for (const repo of repositories) {
    const repoPath = repo.path

    for (const watchDir of config.watchDirs) {
      const fullPath = Path.join(repoPath, watchDir)
      try {
        const stat = Fs.lstatSync(fullPath)
        // Skip if it's already a symlink (already archived)
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          candidates.push({
            repository: repo,
            watchDir,
            sourcePath: fullPath,
          })
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }
  }

  return candidates
}

/** Whether two paths hold byte-for-byte identical files. */
async function sameFileContents(a: string, b: string): Promise<boolean> {
  const [statA, statB] = await Promise.all([lstat(a), lstat(b)])
  if (!statA.isFile() || !statB.isFile() || statA.size !== statB.size) {
    return false
  }
  const [bytesA, bytesB] = await Promise.all([readFile(a), readFile(b)])
  return bytesA.equals(bytesB)
}

/**
 * A name beside `path` that nothing occupies yet, keeping the extension:
 * `chat.md` → `chat.conflict-1.md`, `chat.conflict-2.md`, …
 */
async function freeConflictPath(path: string): Promise<string> {
  const ext = Path.extname(path)
  const stem = path.slice(0, path.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = `${stem}.conflict-${n}${ext}`
    if (!(await pathExists(candidate))) {
      return candidate
    }
  }
}

/**
 * Move everything in `source` into `dest`, then remove the emptied `source`.
 *
 * Never discards anything that differs: folders present on both sides merge
 * recursively, a file identical to the one already archived is dropped as a
 * duplicate, and any other clash is kept beside the archived copy under a
 * `.conflict-N` name. `source` is removed with a plain (non-recursive) rmdir,
 * so if anything were somehow left behind the removal fails loudly instead of
 * deleting it.
 */
export async function mergeDirectoryInto(
  source: string,
  dest: string
): Promise<void> {
  for (const entry of await readdir(source)) {
    const src = Path.join(source, entry)
    const dst = Path.join(dest, entry)

    if (!(await pathExists(dst))) {
      await rename(src, dst)
      continue
    }

    const [srcStat, dstStat] = await Promise.all([lstat(src), lstat(dst)])
    if (srcStat.isDirectory() && dstStat.isDirectory()) {
      await mergeDirectoryInto(src, dst)
    } else if (await sameFileContents(src, dst)) {
      await unlink(src)
    } else {
      await rename(src, await freeConflictPath(dst))
    }
  }

  await rmdir(source)
}

/**
 * Archives a single chat history directory:
 * 1. Moves it to archivePath/<project-name>/<watchDir-basename>, merging into
 *    what's already archived there
 * 2. Creates a symlink from original location to the archive
 */
export async function archiveCandidate(
  candidate: IArchiveCandidate,
  config: IChatHistoryArchiveConfig
): Promise<IArchiveResult> {
  const projectName = Path.basename(candidate.repository.path)

  // An empty or relative archive path would resolve against the process's
  // working directory — archive somewhere nobody chose.
  if (!Path.isAbsolute(config.archivePath)) {
    return {
      candidate,
      destPath: config.archivePath,
      success: false,
      error: 'No archive path set — choose one in Settings → Advanced.',
    }
  }

  const destPath = Path.join(config.archivePath, projectName)

  try {
    await mkdir(destPath, { recursive: true })

    const destFull = Path.join(destPath, Path.basename(candidate.watchDir))

    if (await pathExists(destFull)) {
      // Archived before: merge this history into it.
      await mergeDirectoryInto(candidate.sourcePath, destFull)
    } else {
      await rename(candidate.sourcePath, destFull)
    }

    // Create symlink: source → archive destination
    await symlink(destFull, candidate.sourcePath, 'dir')

    return { candidate, destPath: destFull, success: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error'
    return { candidate, destPath, success: false, error }
  }
}

/**
 * Commits and optionally pushes the archive repo after new history is archived.
 */
export async function commitArchiveRepo(
  config: IChatHistoryArchiveConfig,
  archivedProjects: ReadonlyArray<string>
): Promise<{ success: boolean; error?: string }> {
  const archivePath = config.archivePath

  try {
    // Stage all new files
    const addResult = await git(['add', '.'], archivePath, {})
    if (addResult.exitCode !== 0) {
      return { success: false, error: `git add failed: ${addResult.stderr}` }
    }

    // Check if there's anything to commit
    const statusResult = await git(['status', '--porcelain'], archivePath, {})
    if (statusResult.stdout.trim() === '') {
      return { success: true } // nothing to commit
    }

    const message = `Archive chat history: ${archivedProjects.join(', ')}`
    const commitResult = await git(['commit', '-m', message], archivePath, {})
    if (commitResult.exitCode !== 0) {
      return {
        success: false,
        error: `git commit failed: ${commitResult.stderr}`,
      }
    }

    if (config.autoPush) {
      const pushResult = await git(['push'], archivePath, {})
      if (pushResult.exitCode !== 0) {
        // Non-fatal — committed locally, push can be retried
        log.warn(`[ChatHistoryArchive] Push failed: ${pushResult.stderr}`)
      }
    }

    return { success: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Unknown error'
    return { success: false, error }
  }
}

/** Read the archive log from localStorage. */
export function loadArchiveLog(): ReadonlyArray<IChatHistoryArchiveLogEntry> {
  try {
    const raw = localStorage.getItem(ChatHistoryArchiveLogKey)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Append an entry to the archive log, capping at MaxArchiveLogEntries. */
export function appendArchiveLog(entry: IChatHistoryArchiveLogEntry): void {
  const existing = [...loadArchiveLog()]
  existing.push(entry)
  // Keep only the most recent entries
  const trimmed = existing.slice(-MaxArchiveLogEntries)
  localStorage.setItem(ChatHistoryArchiveLogKey, JSON.stringify(trimmed))
}

/** Clear the archive log. */
export function clearArchiveLog(): void {
  localStorage.removeItem(ChatHistoryArchiveLogKey)
}
