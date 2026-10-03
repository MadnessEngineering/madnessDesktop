import * as React from 'react'
import { VerticalResizable } from './resizable'
import { TerminalTabs } from './terminal-tabs'
import { DotfilesTabs } from './dotfiles-tabs'
import { Octicon } from './octicons'
import * as octicons from './octicons/octicons.generated'
import { IConstrainedValue } from '../lib/app-state'
import { clamp } from '../lib/clamp'
import { reduceTerminalSessions } from './terminal-sessions'
import { ITerminalCommandRequest } from './terminal-command'

export type BottomPanelMode = 'terminal' | 'dotfiles'

interface ITerminalPanelHostProps {
  /**
   * Path of the repository whose session should be visible, or null when the
   * current selection is not a normal repository (cloning / missing / none).
   */
  readonly activeRepoPath: string | null

  /**
   * Paths of every repository currently known to the app. A session whose
   * repository leaves this list is torn down — unmounting its panes kills the
   * backing ptys, so no orphaned shells linger for a removed repo.
   */
  readonly knownRepoPaths: ReadonlyArray<string>

  /** Whether the user wants the panel open. */
  readonly visible: boolean
  readonly mode: BottomPanelMode
  readonly height: IConstrainedValue
  readonly fontSize: number
  readonly cursorBlink: boolean
  readonly scrollback: number

  /**
   * The latest request to run a command in a new terminal tab. Only the
   * session for the request's repository sees it.
   */
  readonly commandRequest: ITerminalCommandRequest | null

  readonly onResize: (height: number) => void
  readonly onResetHeight: () => void
  readonly onSetMode: (mode: BottomPanelMode) => void
  readonly onClose: () => void
}

interface ITerminalPanelHostState {
  /**
   * repoPaths that have a live session, in first-shown order. Kept mounted
   * even while hidden so a repo's terminals (and their scrollback) survive
   * repo swaps and closing the panel.
   */
  readonly sessions: ReadonlyArray<string>
}

/**
 * Host for the integrated terminal / dotfiles bottom panel.
 *
 * Unlike the rest of the repository UI — which remounts on every repo switch —
 * this host lives at the app root and keeps one mounted session per repository
 * it has shown. Only the active repo's session is visible (a `display` toggle,
 * the same trick `TerminalTabs`/`DotfilesTabs` use for their own tabs), so
 * switching repos, or closing and reopening the panel, never discards a running
 * shell.
 */
export class TerminalPanelHost extends React.Component<
  ITerminalPanelHostProps,
  ITerminalPanelHostState
> {
  public state: ITerminalPanelHostState = { sessions: [] }

  public static getDerivedStateFromProps(
    props: ITerminalPanelHostProps,
    state: ITerminalPanelHostState
  ): Partial<ITerminalPanelHostState> | null {
    const sessions = reduceTerminalSessions(state.sessions, {
      visible: props.visible,
      activeRepoPath: props.activeRepoPath,
      knownRepoPaths: props.knownRepoPaths,
    })

    // reduceTerminalSessions returns the same reference on a no-op; skip the
    // state update so we don't churn.
    return sessions === state.sessions ? null : { sessions }
  }

  private renderSession(repoPath: string) {
    const {
      activeRepoPath,
      mode,
      fontSize,
      cursorBlink,
      scrollback,
      commandRequest,
    } = this.props
    const isActive = repoPath === activeRepoPath

    return (
      <div
        key={repoPath}
        className="terminal-panel-session"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        <div
          className="bottom-panel-pane"
          style={{ display: mode === 'terminal' ? 'flex' : 'none' }}
        >
          <TerminalTabs
            cwd={repoPath}
            fontSize={fontSize}
            cursorBlink={cursorBlink}
            scrollback={scrollback}
            commandRequest={
              commandRequest?.repoPath === repoPath ? commandRequest : null
            }
          />
        </div>
        <div
          className="bottom-panel-pane"
          style={{ display: mode === 'dotfiles' ? 'flex' : 'none' }}
        >
          <DotfilesTabs repositoryPath={repoPath} />
        </div>
      </div>
    )
  }

  public render() {
    const { visible, activeRepoPath, mode, height } = this.props

    // Once opened the host stays mounted; `display:none` hides it when the
    // panel is closed or the selection isn't a repository, so a running shell
    // is never torn down by hiding.
    const shown = visible && activeRepoPath !== null

    return (
      <div
        className="terminal-panel-host"
        style={shown ? undefined : { display: 'none' }}
      >
        <VerticalResizable
          id="repository-terminal"
          height={clamp(height)}
          maximumHeight={height.max}
          minimumHeight={height.min}
          onReset={this.props.onResetHeight}
          onResize={this.props.onResize}
          description="Integrated terminal and dotfiles editor"
        >
          <div className="repository-terminal-header">
            <div className="bottom-panel-modes" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'terminal'}
                className={`bottom-panel-mode-tab${
                  mode === 'terminal' ? ' is-active' : ''
                }`}
                onClick={() => this.props.onSetMode('terminal')}
              >
                <Octicon symbol={octicons.terminal} />
                <span>Terminal</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'dotfiles'}
                className={`bottom-panel-mode-tab${
                  mode === 'dotfiles' ? ' is-active' : ''
                }`}
                onClick={() => this.props.onSetMode('dotfiles')}
              >
                <Octicon symbol={octicons.gear} />
                <span>Dotfiles</span>
              </button>
            </div>
            <div className="repository-terminal-path">{activeRepoPath}</div>
            <button
              type="button"
              className="repository-terminal-close"
              onClick={this.props.onClose}
              aria-label="Close panel"
            >
              <Octicon symbol={octicons.x} />
            </button>
          </div>
          <div className="terminal-panel-sessions">
            {this.state.sessions.map(p => this.renderSession(p))}
          </div>
        </VerticalResizable>
      </div>
    )
  }
}
