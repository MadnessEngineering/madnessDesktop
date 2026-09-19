import * as React from 'react'
import { PathLabel } from '../lib/path-label'
import { AppFileStatus } from '../../models/status'
import { IDiff, DiffType, ITextDiff } from '../../models/diff'
import { Octicon, iconForStatus } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { mapStatus } from '../../lib/status'
import { DiffOptions } from './diff-options'
import { ILocalAIConfig } from '../../models/local-ai'
import { loadLocalAIConfig } from '../../lib/local-ai-commit-message'
import { generateLocalAIDiffExplanation } from '../../lib/local-ai-diff-explanation'
import { logActivity } from '../../lib/activity-log'
import { Tooltip, TooltipDirection } from '../lib/tooltip'
import { createObservableRef } from '../lib/observable-ref'
import { Button } from '../lib/button'

interface IDiffHeaderProps {
  readonly path: string
  readonly status: AppFileStatus
  readonly diff: IDiff | null

  /** Whether we should display side by side diffs. */
  readonly showSideBySideDiff: boolean

  /** Called when the user changes the side by side diffs setting. */
  readonly onShowSideBySideDiffChanged: (checked: boolean) => void

  /** Whether we should hide whitespace in diffs. */
  readonly hideWhitespaceInDiff: boolean

  /** Called when the user changes the hide whitespace in diffs setting. */
  readonly onHideWhitespaceInDiffChanged: (checked: boolean) => Promise<void>

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void

  /** Whether the current file can be edited in the working tree. */
  readonly canEditFile?: boolean

  /** Whether the current file is currently open in the built-in editor. */
  readonly isEditingFile?: boolean

  /** Called when the user wants to edit the current working tree file. */
  readonly onEditFile?: () => void

  /** Whether the current file can be shown as rendered markdown. */
  readonly canPreviewFile?: boolean

  /** Whether the rendered markdown is being shown in place of the diff. */
  readonly isPreviewingFile?: boolean

  /** Called when the user switches between the diff and the rendered file. */
  readonly onTogglePreviewFile?: () => void
}

interface IDiffHeaderState {
  readonly localAIConfig: ILocalAIConfig
  readonly isExplaining: boolean
  readonly explanation: string | null
  readonly error: string | null
  readonly isPanelOpen: boolean
}

/** Displays information about a file */
export class DiffHeader extends React.Component<
  IDiffHeaderProps,
  IDiffHeaderState
> {
  private explainButtonRef = createObservableRef<HTMLButtonElement>()

  public constructor(props: IDiffHeaderProps) {
    super(props)
    this.state = {
      localAIConfig: loadLocalAIConfig(),
      isExplaining: false,
      explanation: null,
      error: null,
      isPanelOpen: false,
    }
  }

  public componentDidUpdate(prevProps: IDiffHeaderProps) {
    if (
      prevProps.diff !== this.props.diff ||
      prevProps.path !== this.props.path
    ) {
      this.setState({
        explanation: null,
        error: null,
        isPanelOpen: false,
        isExplaining: false,
      })
    }
  }

  private getTextDiff(): ITextDiff | null {
    const { diff } = this.props
    if (diff?.kind === DiffType.Text) {
      return diff
    }
    return null
  }

  private onExplainClick = async () => {
    const textDiff = this.getTextDiff()
    const { localAIConfig } = this.state
    if (!textDiff || !localAIConfig.enabled) {
      return
    }

    this.setState({
      isExplaining: true,
      explanation: null,
      error: null,
      isPanelOpen: true,
    })

    try {
      const explanation = await generateLocalAIDiffExplanation(
        textDiff.text,
        this.props.path,
        localAIConfig
      )

      this.setState({ explanation, isExplaining: false })

      logActivity(
        'ai-generate',
        `Explained diff for ${this.props.path} via ${localAIConfig.provider}`,
        `model: ${localAIConfig.modelId}`
      )
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      this.setState({ error: message, isExplaining: false })

      logActivity(
        'ai-generate',
        `Diff explanation failed: ${message}`,
        `provider: ${localAIConfig.provider}`
      )
    }
  }

  private onClosePanel = () => {
    this.setState({ isPanelOpen: false })
  }

  public render() {
    const status = this.props.status
    const fileStatus = mapStatus(status)

    return (
      <>
        <div className="header">
          <PathLabel path={this.props.path} status={this.props.status} />

          {this.renderEditButton()}

          {this.renderPreviewButton()}

          {this.renderExplainButton()}

          {this.renderDiffOptions()}

          <Octicon
            symbol={iconForStatus(status)}
            className={'status status-' + fileStatus.toLowerCase()}
            title={fileStatus}
          />
        </div>
        {this.state.isPanelOpen && this.renderExplainPanel()}
      </>
    )
  }

  private renderExplainButton() {
    if (this.props.isEditingFile) {
      return null
    }

    const { localAIConfig, isExplaining } = this.state
    if (!localAIConfig.enabled) {
      return null
    }

    const textDiff = this.getTextDiff()
    if (!textDiff) {
      return null
    }

    const providerLabel =
      localAIConfig.provider === 'lmstudio'
        ? 'LM Studio'
        : localAIConfig.provider === 'ollama'
        ? 'Ollama'
        : 'Local AI'

    const ariaLabel = isExplaining
      ? 'Explaining changes…'
      : `Explain changes with ${providerLabel}`

    return (
      <div className="explain-diff-component">
        <button
          aria-label={ariaLabel}
          onClick={this.onExplainClick}
          disabled={isExplaining}
          ref={this.explainButtonRef}
        >
          <Tooltip
            target={this.explainButtonRef}
            direction={TooltipDirection.NORTH}
            applyAriaDescribedBy={false}
          >
            {ariaLabel}
          </Tooltip>
          {isExplaining ? (
            <Octicon symbol={octicons.sync} className="spin" />
          ) : (
            <Octicon symbol={octicons.hubot} />
          )}
        </button>
      </div>
    )
  }

  private renderExplainPanel() {
    const { isExplaining, explanation, error } = this.state

    return (
      <div className="explain-diff-panel">
        <div className="explain-diff-panel-header">
          <span className="explain-diff-panel-title">
            <Octicon symbol={octicons.hubot} />
            {__DARWIN__ ? 'AI Explanation' : 'AI explanation'}
          </span>
          <button
            className="explain-diff-panel-close"
            onClick={this.onClosePanel}
            aria-label="Close explanation"
          >
            <Octicon symbol={octicons.x} />
          </button>
        </div>
        <div className="explain-diff-panel-body">
          {isExplaining && (
            <div className="explain-diff-loading">
              <Octicon symbol={octicons.sync} className="spin" />
              Analyzing changes…
            </div>
          )}
          {error && (
            <div className="explain-diff-error">
              <Octicon symbol={octicons.alert} />
              {error}
            </div>
          )}
          {explanation && (
            <div className="explain-diff-content">{explanation}</div>
          )}
        </div>
      </div>
    )
  }

  private renderDiffOptions() {
    if (this.props.isEditingFile) {
      return null
    }

    if (this.props.diff?.kind === DiffType.Submodule) {
      return null
    }

    return (
      <DiffOptions
        isInteractiveDiff={true}
        onHideWhitespaceChangesChanged={
          this.props.onHideWhitespaceInDiffChanged
        }
        hideWhitespaceChanges={this.props.hideWhitespaceInDiff}
        onShowSideBySideDiffChanged={this.props.onShowSideBySideDiffChanged}
        showSideBySideDiff={this.props.showSideBySideDiff}
        onDiffOptionsOpened={this.props.onDiffOptionsOpened}
      />
    )
  }

  private renderPreviewButton() {
    const { canPreviewFile, isPreviewingFile, onTogglePreviewFile } = this.props

    if (
      this.props.isEditingFile ||
      !canPreviewFile ||
      onTogglePreviewFile === undefined
    ) {
      return null
    }

    const label = isPreviewingFile
      ? __DARWIN__
        ? 'Show Diff'
        : 'Show diff'
      : __DARWIN__
      ? 'Preview Markdown'
      : 'Preview markdown'

    return (
      <Button
        ariaLabel={label}
        ariaPressed={isPreviewingFile}
        tooltip={label}
        className="diff-header-icon-button"
        onClick={onTogglePreviewFile}
        applyTooltipAriaDescribedBy={false}
      >
        <Octicon symbol={isPreviewingFile ? octicons.fileCode : octicons.book} />
      </Button>
    )
  }

  private renderEditButton() {
    if (
      this.props.isEditingFile ||
      !this.props.canEditFile ||
      this.props.onEditFile === undefined
    ) {
      return null
    }

    const label = __DARWIN__ ? 'Edit File' : 'Edit file'

    return (
      <Button
        ariaLabel={label}
        tooltip={label}
        className="diff-header-icon-button"
        onClick={this.props.onEditFile}
        applyTooltipAriaDescribedBy={false}
      >
        <Octicon symbol={octicons.pencil} />
      </Button>
    )
  }
}
