import React from 'react'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { getEnum } from '../../lib/local-storage'
import { AgentLaunchTarget, agentLaunchTargetKey } from '../../lib/agent-review'

interface ISubmoduleReviewBarProps {
  /** How many commits the review covers, for the placeholder. */
  readonly commitCount: number

  /** Start the session. An empty ask means "use the default review ask". */
  readonly onLaunch: (ask: string, target: AgentLaunchTarget) => void
}

interface ISubmoduleReviewBarState {
  readonly ask: string
  readonly target: AgentLaunchTarget
}

function loadTarget(): AgentLaunchTarget {
  try {
    return (
      getEnum(agentLaunchTargetKey, AgentLaunchTarget) ??
      AgentLaunchTarget.Terminal
    )
  } catch {
    return AgentLaunchTarget.Terminal
  }
}

/**
 * A one-line chat bar under a submodule's commit list: type a question, and a
 * fresh claude session opens in the submodule, pointed at exactly the commits
 * this bump brings in. The toggle picks a Shellomancy tab or the built-in
 * terminal and is remembered per viewer.
 */
export class SubmoduleReviewBar extends React.Component<
  ISubmoduleReviewBarProps,
  ISubmoduleReviewBarState
> {
  public constructor(props: ISubmoduleReviewBarProps) {
    super(props)
    this.state = { ask: '', target: loadTarget() }
  }

  public render() {
    const { commitCount } = this.props
    const { ask, target } = this.state
    const noun = commitCount === 1 ? 'commit' : 'commits'

    return (
      <div className="item submodule-review-bar">
        <Octicon symbol={octicons.sparkle} className="info-icon" />
        <div className="content submodule-review-content">
          <TextBox
            className="submodule-review-input"
            placeholder={`Ask an agent about these ${commitCount} ${noun}… (empty = full review)`}
            value={ask}
            onValueChanged={this.onAskChanged}
            onEnterPressed={this.onLaunch}
            ariaLabel="Ask an agent to review these submodule commits"
          />
          <div
            className="submodule-review-target"
            role="group"
            aria-label="Open the agent session in"
          >
            <Button
              size="small"
              ariaPressed={target === AgentLaunchTarget.Terminal}
              className={
                target === AgentLaunchTarget.Terminal ? 'selected' : undefined
              }
              onClick={this.onPickTerminal}
              tooltip="Open in the built-in terminal"
            >
              Terminal
            </Button>
            <Button
              size="small"
              ariaPressed={target === AgentLaunchTarget.Shellomancy}
              className={
                target === AgentLaunchTarget.Shellomancy
                  ? 'selected'
                  : undefined
              }
              onClick={this.onPickShellomancy}
              tooltip="Open as a Shellomancy tab"
            >
              Shellomancy
            </Button>
          </div>
          <Button type="button" onClick={this.onLaunch}>
            Review ✦
          </Button>
        </div>
      </div>
    )
  }

  private onAskChanged = (ask: string) => {
    this.setState({ ask })
  }

  private setTarget(target: AgentLaunchTarget) {
    this.setState({ target })
    try {
      localStorage.setItem(agentLaunchTargetKey, target)
    } catch {
      // storage unavailable; the pick still holds for this view
    }
  }

  private onPickTerminal = () => this.setTarget(AgentLaunchTarget.Terminal)
  private onPickShellomancy = () =>
    this.setTarget(AgentLaunchTarget.Shellomancy)

  private onLaunch = () => {
    this.props.onLaunch(this.state.ask, this.state.target)
    this.setState({ ask: '' })
  }
}
