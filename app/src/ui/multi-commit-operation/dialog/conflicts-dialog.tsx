import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { Dispatcher } from '../../dispatcher'
import { sendNonFatalException } from '../../../lib/helpers/non-fatal-exception'
import { Repository } from '../../../models/repository'
import {
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
} from '../../../models/status'
import {
  isConflictedFile,
  getResolvedFiles,
  getConflictedFiles,
  getUnmergedFiles,
  getBulkResolutionTargets,
} from '../../../lib/status'
import {
  renderUnmergedFile,
  renderUnmergedFilesSummary,
  renderShellLink,
  renderAllResolved,
} from '../../lib/conflicts'
import { ManualConflictResolution } from '../../../models/manual-conflict-resolution'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { DialogSuccess } from '../../dialog/success'
import { enableCopilotConflictResolution } from '../../../lib/feature-flag'
import { getAccountForCopilotConflictResolution } from '../../../lib/get-account-for-repository'
import { Account } from '../../../models/account'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import { Button } from '../../lib/button'

interface IConflictsDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly workingDirectory: WorkingDirectoryStatus
  readonly userHasResolvedConflicts?: boolean
  readonly resolvedExternalEditor: string | null
  /* Depending on the operation, we may only know one our or their branch */
  readonly ourBranch?: string
  readonly theirBranch?: string
  readonly manualResolutions: Map<string, ManualConflictResolution>
  readonly headerTitle: string | JSX.Element
  readonly submitButton: string
  readonly abortButton: string
  readonly onSubmit: () => Promise<void>
  readonly onAbort: () => Promise<void>
  readonly onDismissed: () => void
  readonly openFileInExternalEditor: (path: string) => void
  readonly openRepositoryInShell: (repository: Repository) => void
  readonly someConflictsHaveBeenResolved?: () => void
  /**
   * Optional callback to initiate Copilot-powered conflict resolution.
   * When provided and the feature flag is enabled, a "Resolve with Copilot"
   * button is shown in the dialog footer.
   */
  readonly onResolveWithCopilot?: () => void
  /**
   * Authenticated GitHub accounts. Used to determine whether the
   * "Resolve with Copilot" button should be shown — the button is only
   * available when at least one account has Copilot for Desktop enabled.
   */
  readonly accounts: ReadonlyArray<Account>
  /**
   * Whether to show the "New" call-to-action bubble on the
   * "Resolve with Copilot" button. Hidden once the user has clicked it
   * for the first time.
   */
  readonly shouldShowCopilotConflictResolutionCallOut: boolean
}

interface IConflictsDialogState {
  readonly isCommitting: boolean
  readonly isAborting: boolean
  readonly isFileResolutionOptionsMenuOpen: boolean
  /**
   * Side picked at the top of the dialog; becomes each row's one-click
   * button. Deliberately not persisted — ours/theirs swap meaning between
   * merge and rebase, and a sticky wrong default is a footgun.
   */
  readonly defaultResolution: ManualConflictResolution | null
}

/**
 * Modal to tell the user their encountered conflicts
 * - To be used generically with conflicts encountered by numerous operations
 *   such as merging, rebasing, cherry-picking, squashing, reordering, etc.
 */
export class ConflictsDialog extends React.Component<
  IConflictsDialogProps,
  IConflictsDialogState
> {
  /** Tracks whether we've ever seen resolved files, for the "undone" banner */
  private hasSeenResolvedFiles = false

  public constructor(props: IConflictsDialogProps) {
    super(props)
    this.state = {
      isCommitting: false,
      isAborting: false,
      isFileResolutionOptionsMenuOpen: false,
      defaultResolution: null,
    }
  }

  /**
   *  Provides us ability to track if user has resolved at least one conflict in
   *  this operation
   */
  public componentWillUnmount() {
    const {
      workingDirectory,
      userHasResolvedConflicts,
      manualResolutions,
      someConflictsHaveBeenResolved,
    } = this.props

    // skip this work once we know conflicts have been resolved
    if (
      userHasResolvedConflicts ||
      someConflictsHaveBeenResolved === undefined
    ) {
      return
    }

    const resolvedConflicts = getResolvedFiles(
      workingDirectory,
      manualResolutions
    )

    if (resolvedConflicts.length > 0) {
      someConflictsHaveBeenResolved()
    }
  }

  /**
   *  Invokes submit callback and dismisses modal
   */
  private onSubmit = async () => {
    this.setState({ isCommitting: true })
    try {
      await this.props.onSubmit()
    } catch (e) {
      this.setState({ isCommitting: false })
      const error = e instanceof Error ? e : new Error(String(e))
      log.error('ConflictsDialog: onSubmit failed', error)
      sendNonFatalException('multiCommitOperation', error)
    }
  }

  /**
   *  Invokes abort callback and dismisses modal
   */
  private onAbort = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()

    this.setState({ isAborting: true })
    try {
      await this.props.onAbort()
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      log.error('ConflictsDialog: onAbort failed', error)
      sendNonFatalException('multiCommitOperation', error)
    } finally {
      this.setState({ isAborting: false })
    }
  }

  private openThisRepositoryInShell = () =>
    this.props.openRepositoryInShell(this.props.repository)

  private setIsFileResolutionOptionsMenuOpen = (
    isFileResolutionOptionsMenuOpen: boolean
  ) => {
    this.setState({ isFileResolutionOptionsMenuOpen })
  }

  private getSideName(resolution: ManualConflictResolution): string {
    return resolution === ManualConflictResolution.ours
      ? this.props.ourBranch ?? 'ours'
      : this.props.theirBranch ?? 'theirs'
  }

  private toggleDefaultResolution(resolution: ManualConflictResolution) {
    this.setState(state => ({
      defaultResolution:
        state.defaultResolution === resolution ? null : resolution,
    }))
  }

  private onPickOurs = () =>
    this.toggleDefaultResolution(ManualConflictResolution.ours)

  private onPickTheirs = () =>
    this.toggleDefaultResolution(ManualConflictResolution.theirs)

  private onResolveAll = () => {
    const resolution = this.state.defaultResolution
    if (resolution === null) {
      return
    }
    const { paths } = getBulkResolutionTargets(
      this.props.workingDirectory,
      this.props.manualResolutions,
      resolution
    )
    this.props.dispatcher.updateManualConflictResolutions(
      this.props.repository,
      paths,
      resolution
    )
  }

  private renderSideButton(
    side: ManualConflictResolution,
    onClick: () => void
  ) {
    const selected = this.state.defaultResolution === side
    const name = this.getSideName(side)
    return (
      <Button
        className={
          selected
            ? 'small-button button-group-item selected'
            : 'small-button button-group-item'
        }
        ariaPressed={selected}
        onClick={onClick}
        tooltip={`Make “Use ${name}” the one-click button on each file`}
      >
        {name}
      </Button>
    )
  }

  private onUndoAll = () => {
    this.props.dispatcher.updateManualConflictResolutions(
      this.props.repository,
      [...this.props.manualResolutions.keys()],
      null
    )
  }

  /**
   * Renders the "pick a side" bar above the file list: choosing a side makes
   * it every row's one-click button, and "Use all" resolves every remaining
   * conflict to it at once.
   */
  private renderBulkResolutionBar(conflictedFilesCount: number) {
    const { defaultResolution } = this.state
    const hasManualResolutions = this.props.manualResolutions.size > 0

    if (conflictedFilesCount === 0 && !hasManualResolutions) {
      return null
    }

    const target =
      defaultResolution === null
        ? null
        : getBulkResolutionTargets(
            this.props.workingDirectory,
            this.props.manualResolutions,
            defaultResolution
          )

    const sideName =
      defaultResolution === null ? null : this.getSideName(defaultResolution)

    let resolveAllTooltip: string
    if (target === null) {
      resolveAllTooltip = 'Pick a side first'
    } else if (target.deletionCount > 0) {
      const files = target.deletionCount === 1 ? 'file' : 'files'
      resolveAllTooltip = `${target.deletionCount} ${files} will be dropped: deleted on ${sideName}`
    } else {
      resolveAllTooltip = `Resolve every remaining conflict using ${sideName}`
    }

    return (
      <div className="bulk-resolution-bar">
        <span className="bulk-resolution-label">Default side:</span>
        <div className="bulk-resolution-sides" role="group">
          {this.renderSideButton(
            ManualConflictResolution.ours,
            this.onPickOurs
          )}
          {this.renderSideButton(
            ManualConflictResolution.theirs,
            this.onPickTheirs
          )}
        </div>
        {conflictedFilesCount > 0 && (
          <Button
            className="small-button"
            disabled={target === null || target.paths.length === 0}
            tooltip={resolveAllTooltip}
            onClick={this.onResolveAll}
          >
            {target === null
              ? `Use all ${conflictedFilesCount}`
              : `Use all ${target.paths.length} from ${sideName}`}
          </Button>
        )}
        {hasManualResolutions && (
          <Button
            className="small-button"
            onClick={this.onUndoAll}
            tooltip="Clear every side you've picked in this dialog"
          >
            Undo all
          </Button>
        )}
      </div>
    )
  }

  /**
   *  Renders the list of conflicts in the dialog
   */
  private renderUnmergedFiles(
    files: ReadonlyArray<WorkingDirectoryFileChange>
  ) {
    let isFirstUnmergedFile = true
    return (
      <ul className="unmerged-file-statuses">
        {files.map(f => {
          if (isConflictedFile(f.status)) {
            const isFirst = isFirstUnmergedFile
            isFirstUnmergedFile = false
            return renderUnmergedFile({
              path: f.path,
              status: f.status,
              resolvedExternalEditor: this.props.resolvedExternalEditor,
              openFileInExternalEditor: this.props.openFileInExternalEditor,
              repository: this.props.repository,
              dispatcher: this.props.dispatcher,
              manualResolution: this.props.manualResolutions.get(f.path),
              ourBranch: this.props.ourBranch,
              theirBranch: this.props.theirBranch,
              isFileResolutionOptionsMenuOpen:
                this.state.isFileResolutionOptionsMenuOpen,
              setIsFileResolutionOptionsMenuOpen:
                this.setIsFileResolutionOptionsMenuOpen,
              isFirstConflictedFile: isFirst,
              defaultResolution: this.state.defaultResolution ?? undefined,
            })
          }
          return null
        })}
      </ul>
    )
  }

  private renderContent(
    unmergedFiles: ReadonlyArray<WorkingDirectoryFileChange>,
    conflictedFilesCount: number
  ): JSX.Element {
    if (unmergedFiles.length === 0) {
      return renderAllResolved()
    }

    return (
      <>
        {renderUnmergedFilesSummary(conflictedFilesCount)}
        {this.renderBulkResolutionBar(conflictedFilesCount)}
        {this.renderUnmergedFiles(unmergedFiles)}
        {renderShellLink(this.openThisRepositoryInShell)}
      </>
    )
  }

  /**
   * Renders the banner based on count of resolved files.
   *
   * Always shows the resolved count when there are resolved files. If the
   * count drops to 0 after having been non-zero, shows the "undone" banner.
   */
  public renderBanner(conflictedFilesCount: number) {
    const { workingDirectory, manualResolutions } = this.props
    const countResolved = getResolvedFiles(
      workingDirectory,
      manualResolutions
    ).length

    if (countResolved > 0) {
      this.hasSeenResolvedFiles = true
    }

    if (countResolved === 0 && !this.hasSeenResolvedFiles) {
      return
    }

    if (countResolved === 0) {
      return <DialogSuccess>All resolutions have been undone.</DialogSuccess>
    }

    if (conflictedFilesCount === 0) {
      return (
        <DialogSuccess>All conflicted files have been resolved. </DialogSuccess>
      )
    }

    const conflictPluralized = countResolved === 1 ? 'file has' : 'files have'
    return (
      <DialogSuccess>
        {countResolved} conflicted {conflictPluralized} been resolved.
      </DialogSuccess>
    )
  }

  /**
   * Renders the "Resolve with Copilot" button when the feature is available.
   * Only shown when:
   * - The onResolveWithCopilot callback is provided (operation supports it)
   * - The feature flag is enabled
   * - There is at least one signed-in account with Copilot for Desktop
   *   enabled (covers "no Copilot subscription" and "disabled by org policy")
   * - There are still conflicted files to resolve
   * - At least one conflicted file can be handled by Copilot (has text
   *   conflict markers or is a delete-vs-modify conflict)
   */
  private renderCopilotButton(
    conflictedFilesCount: number
  ): JSX.Element | null {
    const { onResolveWithCopilot, accounts, repository } = this.props

    if (
      onResolveWithCopilot === undefined ||
      !enableCopilotConflictResolution() ||
      conflictedFilesCount === 0 ||
      getAccountForCopilotConflictResolution(accounts, repository) === undefined
    ) {
      return null
    }

    const button = (
      <Button
        className="copilot-resolve-button"
        onClick={onResolveWithCopilot}
        disabled={this.state.isAborting}
        tooltip={
          this.state.isAborting
            ? 'Cannot resolve while operation is being aborted'
            : 'Use Copilot to suggest resolutions for conflicted files'
        }
      >
        <Octicon symbol={octicons.copilot} />
        {' Resolve with Copilot'}
      </Button>
    )

    if (!this.props.shouldShowCopilotConflictResolutionCallOut) {
      return button
    }

    return (
      <div className="copilot-resolve-button-with-call-out">
        <span className="call-to-action-bubble">New</span>
        {button}
      </div>
    )
  }

  private renderFooter(
    conflictedFilesCount: number,
    submitButton: string,
    tooltipString: string | undefined,
    abortButton: string
  ): JSX.Element {
    const copilotButton = this.renderCopilotButton(conflictedFilesCount)
    const buttonGroup = (
      <OkCancelButtonGroup
        okButtonText={submitButton}
        okButtonDisabled={conflictedFilesCount > 0}
        okButtonTitle={tooltipString}
        cancelButtonText={abortButton}
        onCancelButtonClick={this.onAbort}
        cancelButtonDisabled={this.state.isAborting}
      />
    )

    if (copilotButton === null) {
      return buttonGroup
    }

    return (
      <div className="conflicts-footer-with-copilot">
        {copilotButton}
        {buttonGroup}
      </div>
    )
  }

  public render() {
    const {
      workingDirectory,
      manualResolutions,
      headerTitle,
      submitButton,
      abortButton,
    } = this.props

    const unmergedFiles = getUnmergedFiles(this.props.workingDirectory)
    const conflictedFiles = getConflictedFiles(
      workingDirectory,
      manualResolutions
    )

    const tooltipString =
      conflictedFiles.length > 0
        ? 'Resolve all changes before continuing'
        : undefined

    return (
      <Dialog
        id="conflicts-dialog"
        dismissDisabled={this.state.isCommitting}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        title={headerTitle}
        loading={this.state.isCommitting}
        disabled={this.state.isCommitting}
      >
        {this.renderBanner(conflictedFiles.length)}
        <DialogContent>
          {this.renderContent(unmergedFiles, conflictedFiles.length)}
        </DialogContent>
        <DialogFooter>
          {this.renderFooter(
            conflictedFiles.length,
            submitButton,
            tooltipString,
            abortButton
          )}
        </DialogFooter>
      </Dialog>
    )
  }
}
