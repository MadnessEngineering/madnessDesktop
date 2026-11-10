import { isTypeable, shellQuote } from '../ui/terminal-command'
import { ISubmoduleDiff } from '../models/diff'

/** Where a launched agent session opens. */
export enum AgentLaunchTarget {
  Terminal = 'terminal',
  Shellomancy = 'shellomancy',
}

/**
 * Asks for an agent session reviewing a submodule bump: the diff, how many
 * commits it brings in, what the user typed, and where to open it.
 */
export type LaunchSubmoduleReview = (
  diff: ISubmoduleDiff,
  commitCount: number,
  ask: string,
  target: AgentLaunchTarget
) => void

/** localStorage key for the last-picked launch target (per viewer). */
export const agentLaunchTargetKey = 'agent-launch-target'

/** The ask used when the review bar is submitted empty. */
export const defaultReviewAsk =
  'review these commits for bugs, risky changes, and anything the parent repository should know before committing the bump'

/**
 * The longest user ask kept in the prompt, in code points. Shellomancy
 * refuses commands over 4096 bytes. In the worst case every code point costs
 * 4 bytes (a `'` quotes to `'\''`, an emoji is 4 bytes of UTF-8), so 700
 * leaves ~1300 bytes for the rest of the prompt.
 */
export const maxAskLength = 700

export interface ISubmoduleReviewContext {
  /** The submodule's path relative to the parent repository. */
  readonly submodulePath: string
  /** The parent repository's name, e.g. Madness_Interactive. */
  readonly parentName: string
  readonly oldSHA: string
  readonly newSHA: string
  readonly commitCount: number
  /** What the user typed; empty falls back to `defaultReviewAsk`. */
  readonly ask: string
}

/**
 * Collapse the user's ask to one line of plain text: control characters
 * (newlines included) become spaces, runs of whitespace shrink to one, and
 * the result is capped at `maxAskLength`.
 */
export function sanitizeAsk(ask: string): string {
  const flat = ask
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const codePoints = Array.from(flat)
  return codePoints.length > maxAskLength
    ? codePoints.slice(0, maxAskLength).join('')
    : flat
}

/**
 * The opening prompt for an agent reviewing one submodule bump. It names the
 * range and lets the agent read the commits itself, rather than pasting
 * diffs, so it stays short and single-line.
 */
export function buildSubmoduleReviewPrompt(
  ctx: ISubmoduleReviewContext
): string {
  const ask = sanitizeAsk(ctx.ask) || defaultReviewAsk
  const range = `${ctx.oldSHA}..${ctx.newSHA}`
  const plural = ctx.commitCount === 1 ? 'commit' : 'commits'
  return (
    `Reviewing submodule ${ctx.submodulePath} of ${ctx.parentName}: ` +
    `the parent's gitlink moves ${ctx.oldSHA.slice(0, 7)}..${ctx.newSHA.slice(
      0,
      7
    )} (${ctx.commitCount} ${plural}), and these commits land together as ` +
    `one parent commit. Start with \`git log --stat ${range}\` and ` +
    `\`git diff ${range}\` in this directory. Ask: ${ask}`
  )
}

/**
 * The command line that starts an interactive claude session with the given
 * opening prompt, or null when it can't be typed into a shell safely.
 */
export function claudeCommand(prompt: string): string | null {
  const command = `claude ${shellQuote(prompt)}`
  return isTypeable(command) ? command : null
}
