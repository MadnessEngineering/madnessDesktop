/**
 * A request, from elsewhere in the app, to run a command in a new tab of a
 * repository's integrated terminal.
 */
export interface ITerminalCommandRequest {
  /**
   * Increases with every request, so the terminal can tell a new request from
   * one it has already run when the same request is rendered again.
   */
  readonly id: number
  /** The repository whose terminal should run the command. */
  readonly repoPath: string
  /** The command line, typed into a fresh shell and followed by Enter. */
  readonly command: string
  /** The new tab's label. */
  readonly label: string
}

/**
 * Whether text can be typed into the terminal as-is. The command is sent to
 * the shell as keystrokes, so a control character (Enter, Ctrl-U, Escape, …)
 * would be read by the shell's line editor as a key press rather than as
 * text, and a crafted file name could end the line early and run something
 * else.
 */
export function isTypeable(text: string): boolean {
  return !/[\u0000-\u001f\u007f-\u009f]/.test(text)
}

/**
 * Quote a string as one word for a POSIX shell: wrap it in single quotes and
 * write any single quote inside as '\''. Nothing is special inside single
 * quotes, so `$`, backticks, `;` and spaces stay literal. fish reads it the
 * same way.
 */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/**
 * The command line that opens a file in vim, or null when the path can't be
 * typed into the terminal safely. `command` skips shell aliases and functions,
 * so a dotfile alias such as `alias vim='$EDITOR'` can't turn it into
 * something else.
 */
export function vimCommand(fullPath: string): string | null {
  return isTypeable(fullPath) ? `command vim ${shellQuote(fullPath)}` : null
}
