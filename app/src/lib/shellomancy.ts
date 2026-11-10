import * as Path from 'path'
import * as Os from 'os'
import { access, constants } from 'fs/promises'
import { execFile } from './exec-file'

/**
 * Where the `shellomancy` control CLI may live. An app launched from Finder
 * doesn't inherit the shell's PATH, so look in the usual spots instead of
 * relying on `which`.
 */
function shellomancyCliCandidates(): ReadonlyArray<string> {
  return [
    '/Applications/Shellomancy.app/Contents/Resources/bin/shellomancy',
    Path.join(
      Os.homedir(),
      'Applications/Shellomancy.app/Contents/Resources/bin/shellomancy'
    ),
    Path.join(Os.homedir(), '.local/bin/shellomancy'),
    '/usr/local/bin/shellomancy',
    '/opt/homebrew/bin/shellomancy',
  ]
}

/** The first executable `shellomancy` CLI found, or null. */
export async function findShellomancyCli(): Promise<string | null> {
  for (const candidate of shellomancyCliCandidates()) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // not here; try the next spot
    }
  }
  return null
}

export interface IShellomancyTabOptions {
  /** Run once the tab's shell is ready. One line, at most 4096 bytes. */
  readonly command: string
  readonly cwd: string
  readonly title: string
  /** An ANSI color name, e.g. cyan. */
  readonly color?: string
}

/**
 * Why a Shellomancy tab couldn't be opened. `code` is the control protocol's
 * error code when the CLI reported one (`no_instance`,
 * `insufficient_permissions`, `invalid_params`, …), or `not_installed` when
 * no CLI was found.
 */
export class ShellomancyError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ShellomancyError'
  }
}

/** Pull the protocol error code out of the CLI's `error: <code>: …` line. */
export function parseShellomancyErrorCode(stderr: string): string {
  const match = /error:\s*([a-z_]+)\s*:/.exec(stderr)
  return match === null ? 'unknown' : match[1]
}

export interface IShellomancyWindow {
  readonly window_id: string
  readonly is_active: boolean
  readonly is_quake: boolean
}

/**
 * The window a new tab should land in when Shellomancy can't choose one
 * itself: with several windows and none active (the app isn't frontmost) it
 * answers `ambiguous_target`. Prefer the active window, then the first
 * ordinary one (a quake window is a drop-down, not where a review belongs),
 * then any window at all.
 */
export function pickShellomancyWindow(
  windows: ReadonlyArray<IShellomancyWindow>
): string | null {
  const pick =
    windows.find(w => w.is_active) ??
    windows.find(w => !w.is_quake) ??
    windows[0]
  return pick === undefined ? null : pick.window_id
}

async function runShellomancy(cli: string, args: ReadonlyArray<string>) {
  try {
    return await execFile(cli, [...args], { timeout: 15000 })
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '')
    const code = parseShellomancyErrorCode(stderr)
    throw new ShellomancyError(code, stderr.trim() || String(e))
  }
}

/**
 * Open a Shellomancy tab that runs a command. The command is passed as one
 * argv element (no local shell), and Shellomancy runs it in the tab's shell.
 * Throws a ShellomancyError when the CLI is missing or refuses.
 */
export async function openShellomancyTab(
  options: IShellomancyTabOptions
): Promise<void> {
  const cli = await findShellomancyCli()
  if (cli === null) {
    throw new ShellomancyError(
      'not_installed',
      'The shellomancy CLI was not found.'
    )
  }

  const args = [
    'tab',
    'create',
    '--type',
    'terminal',
    '--command',
    options.command,
    '--cwd',
    options.cwd,
    '--title',
    options.title,
  ]
  if (options.color !== undefined) {
    args.push('--color', options.color)
  }

  try {
    await runShellomancy(cli, args)
  } catch (e) {
    if (!(e instanceof ShellomancyError) || e.code !== 'ambiguous_target') {
      throw e
    }
    const { stdout } = await runShellomancy(cli, [
      'window',
      'list',
      '--output-format',
      'json',
    ])
    const windowId = pickShellomancyWindow(JSON.parse(stdout).windows ?? [])
    if (windowId === null) {
      throw e
    }
    await runShellomancy(cli, [...args, '--window', windowId])
  }
}
