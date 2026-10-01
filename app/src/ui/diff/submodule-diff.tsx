import React from 'react'
import { parseRepositoryIdentifier } from '../../lib/remote-parsing'
import { ISubmoduleDiff } from '../../models/diff'
import { ITextDiff, DiffType } from '../../models/diff'
import { DiffLineType } from '../../models/diff/diff-line'
import { LinkButton } from '../lib/link-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { SuggestedAction } from '../suggested-actions'
import { Ref } from '../lib/ref'
import { CopyButton } from '../copy-button'
import { shortenSHA, CommitOneLine } from '../../models/commit'
import {
  getSubmoduleCommitsBetween,
  getSubmoduleHead,
  ISubmoduleHead,
} from '../../lib/git/submodule'
import { Button } from '../lib/button'
import { Repository } from '../../models/repository'
import { getStatus } from '../../lib/git/status'
import { getWorkingDirectoryDiff, getFilesDiffText } from '../../lib/git/diff'
import { createCommit } from '../../lib/git/commit'
import { getCommits } from '../../lib/git/log'
import {
  appendIgnoreFile,
  appendIgnoreRule,
  ignoreAndUntrack,
} from '../../lib/git/gitignore'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { revealInFileManager, shell as appShell } from '../../lib/app-shell'
import {
  RevealInFileManagerLabel,
  OpenWithDefaultProgramLabel,
  DefaultEditorLabel,
  isSafeFileExtension,
} from '../lib/context-menu'
import { checkoutPaths } from '../../lib/git/checkout'
import { clipboard } from 'electron'
import * as Path from 'path'
import * as FS from 'fs'
import {
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../models/status'
import {
  streamLocalAICommitMessage,
  loadLocalAIConfig,
  ILocalAICommitContext,
} from '../../lib/local-ai-commit-message'
import { ILocalAIConfig } from '../../models/local-ai'

type SubmoduleItemIcon =
  | {
      readonly octicon: typeof octicons.info
      readonly className: 'info-icon'
    }
  | {
      readonly octicon: typeof octicons.diffModified
      readonly className: 'modified-icon'
    }
  | {
      readonly octicon: typeof octicons.diffAdded
      readonly className: 'added-icon'
    }
  | {
      readonly octicon: typeof octicons.diffRemoved
      readonly className: 'removed-icon'
    }
  | {
      readonly octicon: typeof octicons.fileDiff
      readonly className: 'untracked-icon'
    }

interface ISubmoduleDiffProps {
  readonly onOpenSubmodule?: (fullPath: string) => void
  readonly onInitializeSubmodule?: (submodulePath: string) => void
  readonly onSyncSubmodule?: (submodulePath: string) => void
  readonly onRollbackSubmodule?: (submodulePath: string) => void

  /**
   * Called after a commit is made inside the submodule via the inline commit
   * form, so the parent repository can refresh and surface the submodule's
   * updated gitlink for staging.
   */
  readonly onSubmoduleCommitted?: () => void
  readonly onOpenInExternalEditor: (fullPath: string) => void
  readonly externalEditorLabel?: string
  readonly diff: ISubmoduleDiff

  /**
   * Whether the diff is readonly, e.g., displaying a historical diff, or the
   * diff's content can be committed, e.g., displaying a change in the working
   * directory.
   */
  readonly readOnly: boolean
}

interface ISubmoduleDiffState {
  readonly commits: ReadonlyArray<CommitOneLine>
  /** Files changed inside the submodule working directory */
  readonly submoduleFiles: ReadonlyArray<WorkingDirectoryFileChange>
  readonly selectedFile: WorkingDirectoryFileChange | null
  readonly fileDiff: ITextDiff | null
  readonly commitSummary: string
  readonly isCommitting: boolean
  readonly loadingStatus: boolean
  readonly lastCommitSha: string | null
  readonly localAIConfig: ILocalAIConfig | null
  readonly isGeneratingAIMessage: boolean
  /** Where a commit made here would land; null until resolved. */
  readonly head: ISubmoduleHead | null
}

export class SubmoduleDiff extends React.Component<
  ISubmoduleDiffProps,
  ISubmoduleDiffState
> {
  public constructor(props: ISubmoduleDiffProps) {
    super(props)
    this.state = {
      commits: [],
      submoduleFiles: [],
      selectedFile: null,
      fileDiff: null,
      commitSummary: '',
      isCommitting: false,
      loadingStatus: false,
      lastCommitSha: null,
      localAIConfig: null,
      isGeneratingAIMessage: false,
      head: null,
    }
  }

  public async componentDidMount() {
    try {
      this.setState({ localAIConfig: loadLocalAIConfig() })
    } catch {
      // ignore — config load failures fall back to disabled state
    }

    const { diff } = this.props
    if (diff.oldSHA !== null && diff.newSHA !== null) {
      try {
        const commits = await getSubmoduleCommitsBetween(
          diff.fullPath,
          diff.oldSHA,
          diff.newSHA
        )
        this.setState({ commits })
      } catch {
        // submodule may not be initialized; silently skip
      }
    }
    await this.loadSubmoduleStatus()
  }

  public async componentDidUpdate(prevProps: ISubmoduleDiffProps) {
    const { diff } = this.props
    const prev = prevProps.diff
    if (diff.oldSHA !== prev.oldSHA || diff.newSHA !== prev.newSHA) {
      if (diff.oldSHA !== null && diff.newSHA !== null) {
        try {
          const commits = await getSubmoduleCommitsBetween(
            diff.fullPath,
            diff.oldSHA,
            diff.newSHA
          )
          this.setState({ commits })
        } catch {
          this.setState({ commits: [] })
        }
      } else {
        this.setState({ commits: [] })
      }
    }
    if (
      diff.fullPath !== prev.fullPath ||
      diff.status.modifiedChanges !== prev.status.modifiedChanges ||
      diff.status.untrackedChanges !== prev.status.untrackedChanges
    ) {
      await this.loadSubmoduleStatus()
    }
  }

  private getSubmoduleRepo(): Repository {
    return new Repository(this.props.diff.fullPath, -1, null, false)
  }

  private async loadSubmoduleStatus() {
    const { diff } = this.props
    if (diff.entryStatus === 'uninitialized') {
      this.setState({
        submoduleFiles: [],
        selectedFile: null,
        fileDiff: null,
        head: null,
      })
      return
    }

    // Resolved even when there's nothing to commit — the post-commit
    // confirmation names the branch too.
    try {
      this.setState({ head: await getSubmoduleHead(diff.fullPath) })
    } catch {
      this.setState({ head: null })
    }

    if (!diff.status.modifiedChanges && !diff.status.untrackedChanges) {
      this.setState({ submoduleFiles: [], selectedFile: null, fileDiff: null })
      return
    }

    this.setState({ loadingStatus: true })

    try {
      const status = await getStatus(this.getSubmoduleRepo())
      if (status !== null) {
        const files = status.workingDirectory.files
        this.setState({ submoduleFiles: files, loadingStatus: false })
      } else {
        this.setState({ submoduleFiles: [], loadingStatus: false })
      }
    } catch {
      this.setState({ submoduleFiles: [], loadingStatus: false })
    }
  }

  private onFileClick = async (file: WorkingDirectoryFileChange) => {
    if (
      this.state.selectedFile?.path === file.path &&
      this.state.fileDiff !== null
    ) {
      this.setState({ selectedFile: null, fileDiff: null })
      return
    }

    this.setState({ selectedFile: file, fileDiff: null })
    try {
      const diff = await getWorkingDirectoryDiff(
        this.getSubmoduleRepo(),
        file,
        false
      )
      if (diff.kind === DiffType.Text) {
        this.setState({ fileDiff: diff })
      }
    } catch {
      // binary or unreadable diff — show nothing
    }
  }

  private onCommit = async () => {
    const { submoduleFiles, commitSummary } = this.state
    if (submoduleFiles.length === 0 || commitSummary.trim() === '') {
      return
    }

    this.setState({ isCommitting: true })
    try {
      const sha = await createCommit(
        this.getSubmoduleRepo(),
        commitSummary.trim(),
        submoduleFiles
      )
      this.setState({
        isCommitting: false,
        lastCommitSha: sha,
        commitSummary: '',
        submoduleFiles: [],
        selectedFile: null,
        fileDiff: null,
      })
      // Refresh the parent repository so the submodule's bumped gitlink shows
      // up as a stageable change instead of leaving the changes list stale.
      this.props.onSubmoduleCommitted?.()
    } catch (e) {
      this.setState({ isCommitting: false })
    }
  }

  private onGenerateAICommitMessage = async () => {
    const { submoduleFiles, localAIConfig, isGeneratingAIMessage } = this.state
    if (
      submoduleFiles.length === 0 ||
      !localAIConfig?.enabled ||
      isGeneratingAIMessage
    ) {
      return
    }

    this.setState({ isGeneratingAIMessage: true })
    const submoduleRepo = this.getSubmoduleRepo()

    try {
      const diffText = await getFilesDiffText(submoduleRepo, submoduleFiles)
      if (!diffText) {
        this.setState({ isGeneratingAIMessage: false })
        return
      }

      let recentCommits: ReadonlyArray<string> = []
      try {
        const commits = await getCommits(submoduleRepo, undefined, 5)
        recentCommits = commits.map(c => c.summary)
      } catch {
        // best-effort context
      }

      const context: ILocalAICommitContext = { recentCommits }

      const result = await streamLocalAICommitMessage(
        diffText,
        localAIConfig,
        context,
        progress => {
          if (progress.title) {
            this.setState({ commitSummary: progress.title })
          }
        }
      )
      this.setState({
        commitSummary: result.title,
        isGeneratingAIMessage: false,
      })
    } catch {
      this.setState({ isGeneratingAIMessage: false })
    }
  }

  public render() {
    return (
      <div className="changes-interstitial submodule-diff">
        <div className="content">
          <div className="interstitial-header">
            <div className="text">
              <h1>Submodule changes</h1>
            </div>
          </div>
          {this.renderSubmoduleInfo()}
          {this.renderCommitChangeInfo()}
          {this.renderCommitHistory()}
          {this.renderSubmodulesChangesInfo()}
          {this.renderInlineChanges()}
          {this.renderQuickActions()}
          {this.renderOpenSubmoduleAction()}
        </div>
      </div>
    )
  }

  private renderSubmoduleInfo() {
    if (this.props.diff.url === null) {
      return null
    }

    const repoIdentifier = parseRepositoryIdentifier(this.props.diff.url)
    if (repoIdentifier === null) {
      return null
    }

    const hostname =
      repoIdentifier.hostname === 'github.com'
        ? ''
        : ` (${repoIdentifier.hostname})`

    return this.renderSubmoduleDiffItem(
      { octicon: octicons.info, className: 'info-icon' },
      <>
        This is a submodule based on the repository{' '}
        <LinkButton
          uri={`https://${repoIdentifier.hostname}/${repoIdentifier.owner}/${repoIdentifier.name}`}
        >
          {repoIdentifier.owner}/{repoIdentifier.name}
          {hostname}
        </LinkButton>
        .
      </>
    )
  }

  private renderCommitChangeInfo() {
    const { diff, readOnly } = this.props
    const { oldSHA, newSHA } = diff

    const verb = readOnly ? 'was' : 'has been'
    const suffix = readOnly
      ? ''
      : ' This change can be committed to the parent repository.'

    if (oldSHA !== null && newSHA !== null) {
      return this.renderSubmoduleDiffItem(
        { octicon: octicons.diffModified, className: 'modified-icon' },
        <>
          This submodule changed its commit from{' '}
          {this.renderCommitSHA(oldSHA, 'previous')} to{' '}
          {this.renderCommitSHA(newSHA, 'new')}.{suffix}
        </>
      )
    } else if (oldSHA === null && newSHA !== null) {
      return this.renderSubmoduleDiffItem(
        { octicon: octicons.diffAdded, className: 'added-icon' },
        <>
          This submodule {verb} added pointing at commit{' '}
          {this.renderCommitSHA(newSHA)}.{suffix}
        </>
      )
    } else if (oldSHA !== null && newSHA === null) {
      return this.renderSubmoduleDiffItem(
        { octicon: octicons.diffRemoved, className: 'removed-icon' },
        <>
          This submodule {verb} removed while it was pointing at commit{' '}
          {this.renderCommitSHA(oldSHA)}.{suffix}
        </>
      )
    }

    return null
  }

  private renderCommitHistory() {
    const { commits } = this.state
    if (commits.length === 0) {
      return null
    }

    return (
      <div className="item submodule-commit-history">
        <Octicon symbol={octicons.gitCommit} className="info-icon" />
        <div className="content">
          <p>Commits included in this change:</p>
          <ul className="submodule-commits">
            {commits.map(c => (
              <li key={c.sha}>
                <Ref>{shortenSHA(c.sha)}</Ref> {c.summary}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  private renderCommitSHA(sha: string, which?: 'previous' | 'new') {
    const whichInfix = which === undefined ? '' : ` ${which}`

    return (
      <>
        <Ref>{shortenSHA(sha)}</Ref>
        <CopyButton
          ariaLabel={`Copy the full${whichInfix} SHA`}
          copyContent={sha}
        />
      </>
    )
  }

  private renderSubmodulesChangesInfo() {
    const { diff } = this.props

    if (!diff.status.untrackedChanges && !diff.status.modifiedChanges) {
      return null
    }

    const changes =
      diff.status.untrackedChanges && diff.status.modifiedChanges
        ? 'modified and untracked'
        : diff.status.untrackedChanges
        ? 'untracked'
        : 'modified'

    return this.renderSubmoduleDiffItem(
      { octicon: octicons.fileDiff, className: 'untracked-icon' },
      <>
        This submodule has {changes} changes. Commit them below before updating
        the parent repository.
      </>
    )
  }

  private renderInlineChanges() {
    const {
      submoduleFiles,
      selectedFile,
      fileDiff,
      commitSummary,
      isCommitting,
      loadingStatus,
      lastCommitSha,
      localAIConfig,
      isGeneratingAIMessage,
      head,
    } = this.state
    const { diff, readOnly } = this.props

    if (readOnly || diff.entryStatus === 'uninitialized') {
      return null
    }

    if (lastCommitSha !== null && submoduleFiles.length === 0) {
      return (
        <div className="item submodule-inline-changes">
          <Octicon symbol={octicons.check} className="added-icon" />
          <div className="content">
            <p>
              Committed to {head?.branch ?? 'detached HEAD'} in submodule:{' '}
              <Ref>{shortenSHA(lastCommitSha)}</Ref>
            </p>
          </div>
        </div>
      )
    }

    if (loadingStatus) {
      return (
        <div className="item submodule-inline-changes">
          <Octicon symbol={octicons.sync} className="info-icon" />
          <div className="content">
            <p>Loading submodule changes…</p>
          </div>
        </div>
      )
    }

    if (submoduleFiles.length === 0) {
      return null
    }

    return (
      <div className="submodule-inline-changes">
        <div className="submodule-inline-header">
          <Octicon symbol={octicons.listUnordered} className="info-icon" />
          <span>
            {submoduleFiles.length} file
            {submoduleFiles.length !== 1 ? 's' : ''} changed in submodule
          </span>
          {this.renderHeadBadge()}
        </div>

        {this.renderDetachedHeadWarning()}

        <div className="submodule-file-list">
          {submoduleFiles.map(f => this.renderFileListItem(f))}
        </div>

        {selectedFile !== null && fileDiff !== null && (
          <div className="submodule-file-diff">
            <div className="submodule-file-diff-header">
              {selectedFile.path}
            </div>
            <div className="submodule-diff-lines">
              {fileDiff.hunks.map((hunk, hi) => (
                <React.Fragment key={hi}>
                  <div className="submodule-diff-line hunk-header">
                    {hunk.header.toDiffLineRepresentation()}
                  </div>
                  {hunk.lines.map((line, li) => {
                    const lineClass =
                      line.type === DiffLineType.Add
                        ? 'add'
                        : line.type === DiffLineType.Delete
                        ? 'delete'
                        : line.type === DiffLineType.Hunk
                        ? 'hunk-header'
                        : 'context'
                    return (
                      <div
                        key={li}
                        className={`submodule-diff-line ${lineClass}`}
                      >
                        {line.text}
                      </div>
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        <div className="submodule-commit-form">
          <input
            className="submodule-commit-summary"
            type="text"
            placeholder={
              isGeneratingAIMessage
                ? 'Generating with local AI…'
                : 'Summary (required)'
            }
            value={commitSummary}
            onChange={e => this.setState({ commitSummary: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter' && !isCommitting) {
                this.onCommit()
              }
            }}
            disabled={isGeneratingAIMessage}
          />
          {localAIConfig?.enabled && (
            <Button
              className="submodule-local-ai-button"
              onClick={this.onGenerateAICommitMessage}
              disabled={
                isCommitting ||
                isGeneratingAIMessage ||
                submoduleFiles.length === 0
              }
              type="button"
              ariaLabel={
                isGeneratingAIMessage
                  ? 'Generating commit message…'
                  : `Generate commit message with ${
                      localAIConfig.provider === 'lmstudio'
                        ? 'LM Studio'
                        : localAIConfig.provider === 'ollama'
                        ? 'Ollama'
                        : 'Local AI'
                    }`
              }
              tooltip={
                isGeneratingAIMessage
                  ? 'Generating commit message…'
                  : `Generate commit message with ${
                      localAIConfig.provider === 'lmstudio'
                        ? 'LM Studio'
                        : localAIConfig.provider === 'ollama'
                        ? 'Ollama'
                        : 'Local AI'
                    }`
              }
            >
              <Octicon symbol={octicons.hubot} />
            </Button>
          )}
          <Button
            onClick={this.onCommit}
            disabled={
              commitSummary.trim() === '' ||
              isCommitting ||
              isGeneratingAIMessage
            }
            type="button"
          >
            {isCommitting
              ? 'Committing…'
              : `Commit ${submoduleFiles.length} file${
                  submoduleFiles.length !== 1 ? 's' : ''
                } to ${head?.branch ?? 'detached HEAD'}`}
          </Button>
        </div>
      </div>
    )
  }

  /**
   * The branch chip in the inline changes header — the submodule's answer to
   * the parent repository's "Commit to <branch>" button.
   */
  private renderHeadBadge() {
    const { head } = this.state
    if (head === null) {
      return null
    }

    if (head.branch !== null) {
      return (
        <span className="submodule-head-badge">
          <Octicon symbol={octicons.gitBranch} />
          {head.branch}
        </span>
      )
    }

    return (
      <span className="submodule-head-badge detached">
        <Octicon symbol={octicons.alert} />
        detached HEAD
      </span>
    )
  }

  /**
   * Committing onto a detached HEAD produces a commit no branch points at, so
   * say what happens to it before the commit rather than after.
   */
  private renderDetachedHeadWarning() {
    const { head } = this.state
    if (head === null || head.branch !== null) {
      return null
    }

    return (
      <div className="submodule-head-warning">
        <Octicon symbol={octicons.alert} className="modified-icon" />
        <span>
          {head.upstreamBranch !== null ? (
            <>
              HEAD is detached. The commit won't be on a local branch; pushing
              this submodule delivers it to <Ref>{head.upstreamBranch}</Ref>.
              Check out a branch first to keep it locally.
            </>
          ) : (
            <>
              HEAD is detached with no upstream branch. The commit won't belong
              to any branch and won't be pushed — check out a branch before
              committing.
            </>
          )}
        </span>
      </div>
    )
  }

  private renderFileListItem(file: WorkingDirectoryFileChange) {
    const { selectedFile } = this.state
    const isSelected = selectedFile?.path === file.path
    const statusClass = this.fileStatusClass(file)

    return (
      <div
        key={file.path}
        className={`submodule-file-item ${statusClass}${
          isSelected ? ' selected' : ''
        }`}
        onClick={() => this.onFileClick(file)}
        onContextMenu={e => this.onContextMenu(file, e)}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            this.onFileClick(file)
          }
        }}
      >
        <span className="submodule-file-status">
          {this.fileStatusLabel(file)}
        </span>
        <span className="submodule-file-path">{file.path}</span>
      </div>
    )
  }

  private onContextMenu = (
    file: WorkingDirectoryFileChange,
    event: React.MouseEvent
  ) => {
    event.preventDefault()

    const { path } = file
    const extension = Path.extname(path)
    const isSafeExtension = isSafeFileExtension(extension)
    const isGitIgnore = path.endsWith('.gitignore')
    // Ignoring a file git already tracks has no effect until it's removed
    // from the index, so tracked files also get an ignore-and-untrack item.
    const isTracked =
      file.status.kind !== AppFileStatusKind.Untracked &&
      file.status.kind !== AppFileStatusKind.Conflicted

    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Discard Changes…' : 'Discard changes…',
        action: () => this.onDiscardChanges(file),
      },
      { type: 'separator' },
      {
        label: __DARWIN__
          ? 'Ignore File (Add to .gitignore)'
          : 'Ignore file (add to .gitignore)',
        action: () => this.onIgnoreFile(path),
        enabled: !isGitIgnore,
      },
    ]

    if (isTracked) {
      items.push({
        label: __DARWIN__
          ? 'Ignore and Untrack File (Keep on Disk)'
          : 'Ignore and untrack file (keep on disk)',
        action: () => this.onIgnoreAndUntrackFile(path),
        enabled: !isGitIgnore,
      })
    }

    const pathComponents = path.split('/').slice(0, -1)
    if (pathComponents.length > 0) {
      const folders = pathComponents.map(
        (_, index) =>
          `/${pathComponents.slice(0, pathComponents.length - index).join('/')}`
      )

      items.push({
        label: __DARWIN__
          ? 'Ignore Folder (Add to .gitignore)'
          : 'Ignore folder (add to .gitignore)',
        submenu: folders.map(label => ({
          label,
          action: () => this.onIgnoreFile(label),
        })),
        enabled: !isGitIgnore,
      })

      if (isTracked) {
        items.push({
          label: __DARWIN__
            ? 'Ignore and Untrack Folder (Keep on Disk)'
            : 'Ignore and untrack folder (keep on disk)',
          submenu: folders.map(label => ({
            label,
            action: () => this.onIgnoreAndUntrackFile(label),
          })),
          enabled: !isGitIgnore,
        })
      }
    }

    if (extension.length > 0) {
      items.push({
        label: __DARWIN__
          ? `Ignore All ${extension} Files (Add to .gitignore)`
          : `Ignore all ${extension} files (add to .gitignore)`,
        action: () => this.onIgnorePattern(`*${extension}`),
        enabled: !isGitIgnore,
      })
    }

    items.push(
      { type: 'separator' },
      {
        label: __DARWIN__ ? 'Copy Path' : 'Copy path',
        action: () =>
          clipboard.writeText(Path.join(this.props.diff.fullPath, path)),
      },
      {
        label: __DARWIN__ ? 'Copy Relative Path' : 'Copy relative path',
        action: () => clipboard.writeText(Path.normalize(path)),
      },
      { type: 'separator' },
      {
        label: RevealInFileManagerLabel,
        action: () => revealInFileManager(this.getSubmoduleRepo(), path),
        enabled: file.status.kind !== AppFileStatusKind.Deleted,
      }
    )

    const isDeleted = file.status.kind === AppFileStatusKind.Deleted
    const { externalEditorLabel } = this.props
    const openInExternalEditorLabel = externalEditorLabel
      ? `Open in ${externalEditorLabel}`
      : DefaultEditorLabel

    items.push({
      label: openInExternalEditorLabel,
      action: () => this.onOpenItemInExternalEditor(path),
      enabled: !isDeleted,
    })

    items.push({
      label: OpenWithDefaultProgramLabel,
      action: () => this.onOpenItem(path),
      enabled: !isDeleted && isSafeExtension,
    })

    showContextualMenu(items)
  }

  private onDiscardChanges = async (file: WorkingDirectoryFileChange) => {
    const submoduleRepo = this.getSubmoduleRepo()
    if (
      file.status.kind === AppFileStatusKind.Untracked ||
      file.status.kind === AppFileStatusKind.New
    ) {
      const fullPath = Path.join(submoduleRepo.path, file.path)
      try {
        await appShell.moveItemToTrash(fullPath)
      } catch (e) {
        await new Promise<void>((resolve, reject) => {
          FS.unlink(fullPath, err => {
            if (err) {
              reject(err)
            } else {
              resolve()
            }
          })
        })
      }
    } else {
      await checkoutPaths(submoduleRepo, [file.path])
    }
    await this.loadSubmoduleStatus()
  }

  private onOpenItem = (path: string) => {
    const fullPath = Path.join(this.getSubmoduleRepo().path, path)
    appShell.openPath(fullPath)
  }

  private onOpenItemInExternalEditor = (path: string) => {
    const fullPath = Path.join(this.getSubmoduleRepo().path, path)
    this.props.onOpenInExternalEditor(fullPath)
  }

  private onIgnoreFile = async (path: string) => {
    try {
      await appendIgnoreFile(this.getSubmoduleRepo(), path)
    } catch (error) {
      log.error('Failed to ignore submodule file', error)
    }
    await this.loadSubmoduleStatus()
  }

  private onIgnorePattern = async (pattern: string) => {
    await appendIgnoreRule(this.getSubmoduleRepo(), pattern)
    await this.loadSubmoduleStatus()
  }

  private onIgnoreAndUntrackFile = async (path: string) => {
    try {
      await ignoreAndUntrack(this.getSubmoduleRepo(), path)
    } catch (error) {
      log.error('Failed to ignore and untrack submodule file', error)
    }
    await this.loadSubmoduleStatus()
  }

  private fileStatusClass(file: WorkingDirectoryFileChange): string {
    switch (file.status.kind) {
      case AppFileStatusKind.New:
      case AppFileStatusKind.Untracked:
        return 'added'
      case AppFileStatusKind.Deleted:
        return 'deleted'
      case AppFileStatusKind.Modified:
        return 'modified'
      case AppFileStatusKind.Renamed:
      case AppFileStatusKind.Copied:
        return 'renamed'
      default:
        return 'modified'
    }
  }

  private fileStatusLabel(file: WorkingDirectoryFileChange): string {
    switch (file.status.kind) {
      case AppFileStatusKind.New:
      case AppFileStatusKind.Untracked:
        return 'A'
      case AppFileStatusKind.Deleted:
        return 'D'
      case AppFileStatusKind.Renamed:
        return 'R'
      case AppFileStatusKind.Copied:
        return 'C'
      case AppFileStatusKind.Conflicted:
        return '!'
      default:
        return 'M'
    }
  }

  private renderQuickActions() {
    const {
      diff,
      readOnly,
      onInitializeSubmodule,
      onSyncSubmodule,
      onRollbackSubmodule,
    } = this.props

    const showInitialize =
      diff.entryStatus === 'uninitialized' &&
      onInitializeSubmodule !== undefined
    const showSync = diff.url !== null && onSyncSubmodule !== undefined
    const showRollback =
      !readOnly &&
      diff.oldSHA !== null &&
      diff.newSHA !== null &&
      onRollbackSubmodule !== undefined

    if (!showInitialize && !showSync && !showRollback) {
      return null
    }

    return (
      <div className="item submodule-actions">
        <Octicon symbol={octicons.zap} className="info-icon" />
        <div className="content submodule-action-buttons">
          {showInitialize && (
            <Button
              onClick={() => onInitializeSubmodule!(diff.path)}
              type="button"
            >
              Initialize
            </Button>
          )}
          {showSync && (
            <Button onClick={() => onSyncSubmodule!(diff.path)} type="button">
              Sync
            </Button>
          )}
          {showRollback && (
            <Button
              onClick={() => onRollbackSubmodule!(diff.path)}
              type="button"
            >
              Rollback
            </Button>
          )}
        </div>
      </div>
    )
  }

  private renderSubmoduleDiffItem(
    icon: SubmoduleItemIcon,
    content: React.ReactElement
  ) {
    return (
      <div className="item">
        <Octicon symbol={icon.octicon} className={icon.className} />
        <div className="content">{content}</div>
      </div>
    )
  }

  private renderOpenSubmoduleAction() {
    const { diff } = this.props

    // Show the Open button if we have a URL *or* the submodule directory
    // exists on disk (covers uninitialized / deleted-from-config cases).
    if (diff.url === null && diff.entryStatus === 'uninitialized') {
      return null
    }

    return (
      <span>
        <SuggestedAction
          title="Open this submodule on Madness Desktop"
          description="You can open this submodule on Madness Desktop as a normal repository to manage and commit any changes in it."
          buttonText={__DARWIN__ ? 'Open Repository' : 'Open repository'}
          type="primary"
          onClick={this.onOpenSubmoduleClick}
        />
      </span>
    )
  }

  private onOpenSubmoduleClick = () => {
    this.props.onOpenSubmodule?.(this.props.diff.fullPath)
  }
}
