import * as React from 'react'
import { readFile, writeFile } from 'fs/promises'
import { DiffHeader } from '../diff/diff-header'
import {
  MarkdownPreview,
  isMarkdownFile,
  markdownPreviewKey,
} from '../diff/markdown-preview'
import { Emoji } from '../../lib/emoji'
import { getBoolean, setBoolean } from '../../lib/local-storage'
import {
  DiffSelection,
  DiffType,
  IDiff,
  ImageDiffType,
  ITextDiff,
} from '../../models/diff'
import {
  AppFileStatusKind,
  WorkingDirectoryFileChange,
} from '../../models/status'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { SeamlessDiffSwitcher } from '../diff/seamless-diff-switcher'
import { PopupType } from '../../models/popup'
import { resolveWithin } from '../../lib/path'
import { Button } from '../lib/button'
import { TextArea } from '../lib/text-area'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

interface IChangesProps {
  readonly repository: Repository
  readonly file: WorkingDirectoryFileChange
  readonly diff: IDiff | null
  readonly dispatcher: Dispatcher
  readonly imageDiffType: ImageDiffType

  /** Whether a commit is in progress */
  readonly isCommitting: boolean
  readonly hideWhitespaceInDiff: boolean

  /**
   * Called when the user requests to open a binary file in an the
   * system-assigned application for said file type.
   */
  readonly onOpenBinaryFile: (fullPath: string) => void

  /** Called when the user requests to open a submodule. */
  readonly onOpenSubmodule: (fullPath: string) => void

  /** Called when the user clicks Initialize on an uninitialized submodule. */
  readonly onInitializeSubmodule?: (submodulePath: string) => void

  /** Called when the user clicks Sync on a submodule. */
  readonly onSyncSubmodule?: (submodulePath: string) => void

  /** Called when the user clicks Rollback on a modified submodule. */
  readonly onRollbackSubmodule?: (submodulePath: string) => void

  /**
   * Called when the user is viewing an image diff and requests
   * to change the diff presentation mode.
   */
  readonly onChangeImageDiffType: (type: ImageDiffType) => void

  /**
   * Whether we should show a confirmation dialog when the user
   * discards changes
   */
  readonly askForConfirmationOnDiscardChanges: boolean

  /**
   * Whether we should display side by side diffs.
   */
  readonly showSideBySideDiff: boolean

  /** Whether or not to show the diff check marks indicating inclusion in a commit */
  readonly showDiffCheckMarks: boolean

  /** The label for the external editor. */
  readonly externalEditorLabel?: string

  /** Called when the user opens the diff options popover */
  readonly onDiffOptionsOpened: () => void

  /** Map from the emoji shortcut (e.g., :+1:) to the image's local path. */
  readonly emoji: Map<string, Emoji>
}

interface IChangesState {
  readonly isEditingFile: boolean
  readonly isPreviewingFile: boolean
  readonly isLoadingEditor: boolean
  readonly isSavingEditor: boolean
  readonly editorText: string
  readonly originalEditorText: string
  readonly editorError: string | null
}

export class Changes extends React.Component<IChangesProps, IChangesState> {
  public constructor(props: IChangesProps) {
    super(props)

    this.state = {
      isEditingFile: false,
      isPreviewingFile: getBoolean(markdownPreviewKey, false),
      isLoadingEditor: false,
      isSavingEditor: false,
      editorText: '',
      originalEditorText: '',
      editorError: null,
    }
  }

  /**
   * Whether or not it's currently possible to change the line selection
   * of a diff. Changing selection is not possible while a commit is in
   * progress or if the user has opted to hide whitespace changes.
   */
  private get lineSelectionDisabled() {
    return this.props.isCommitting || this.props.hideWhitespaceInDiff
  }

  private get canEditFile() {
    const { diff, file } = this.props

    return (
      diff?.kind === DiffType.Text &&
      file.status.kind !== AppFileStatusKind.Deleted &&
      file.status.submoduleStatus === undefined
    )
  }

  private get canPreviewFile() {
    const { file } = this.props

    return (
      isMarkdownFile(file.path) && file.status.submoduleStatus === undefined
    )
  }

  private onTogglePreviewFile = () => {
    const isPreviewingFile = !this.state.isPreviewingFile
    setBoolean(markdownPreviewKey, isPreviewingFile)
    this.setState({ isPreviewingFile })
  }

  private onMarkdownLinkClicked = (url: string) => {
    this.props.dispatcher.openInBrowser(url)
  }

  private get editorHasChanges() {
    return this.state.editorText !== this.state.originalEditorText
  }

  public componentDidUpdate(prevProps: IChangesProps) {
    if (prevProps.file.id !== this.props.file.id) {
      this.resetEditorState()
    }
  }

  private onDiffLineIncludeChanged = (selection: DiffSelection) => {
    if (!this.lineSelectionDisabled) {
      const { repository, file } = this.props
      this.props.dispatcher.changeFileLineSelection(repository, file, selection)
    }
  }

  private onSubmoduleCommitted = () => {
    this.props.dispatcher.refreshRepository(this.props.repository)
  }

  private onDiscardChanges = (
    diff: ITextDiff,
    diffSelection: DiffSelection
  ) => {
    if (this.lineSelectionDisabled) {
      return
    }

    if (this.props.askForConfirmationOnDiscardChanges) {
      this.props.dispatcher.showPopup({
        type: PopupType.ConfirmDiscardSelection,
        repository: this.props.repository,
        file: this.props.file,
        diff,
        selection: diffSelection,
      })
    } else {
      this.props.dispatcher.discardChangesFromSelection(
        this.props.repository,
        this.props.file.path,
        diff,
        diffSelection
      )
    }
  }

  private resetEditorState() {
    if (
      !this.state.isEditingFile &&
      !this.state.isLoadingEditor &&
      !this.state.isSavingEditor &&
      this.state.editorText.length === 0 &&
      this.state.originalEditorText.length === 0 &&
      this.state.editorError === null
    ) {
      return
    }

    this.setState({
      isEditingFile: false,
      isLoadingEditor: false,
      isSavingEditor: false,
      editorText: '',
      originalEditorText: '',
      editorError: null,
    })
  }

  private getEditableFilePath = async () => {
    if (!this.canEditFile) {
      return null
    }

    return resolveWithin(this.props.repository.path, this.props.file.path)
  }

  private getEditorErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error'
  }

  private onEditFile = async () => {
    if (!this.canEditFile) {
      return
    }

    const fileID = this.props.file.id

    this.setState({
      isEditingFile: true,
      isLoadingEditor: true,
      isSavingEditor: false,
      editorText: '',
      originalEditorText: '',
      editorError: null,
    })

    try {
      const filePath = await this.getEditableFilePath()
      if (filePath === null) {
        throw new Error('Unable to edit this file from the Changes view.')
      }

      const contents = await readFile(filePath, 'utf8')

      if (this.props.file.id !== fileID) {
        return
      }

      this.setState({
        isLoadingEditor: false,
        editorText: contents,
        originalEditorText: contents,
      })
    } catch (error) {
      if (this.props.file.id !== fileID) {
        return
      }

      this.setState({
        isLoadingEditor: false,
        editorError: this.getEditorErrorMessage(error),
      })
    }
  }

  private onCancelEditFile = () => {
    this.resetEditorState()
  }

  private onEditorTextChanged = (editorText: string) => {
    this.setState({ editorText, editorError: null })
  }

  private onSaveEditFile = async () => {
    if (
      !this.canEditFile ||
      this.state.isLoadingEditor ||
      this.state.isSavingEditor
    ) {
      return
    }

    const fileID = this.props.file.id

    this.setState({ isSavingEditor: true, editorError: null })

    try {
      const filePath = await this.getEditableFilePath()
      if (filePath === null) {
        throw new Error('Unable to save this file from the Changes view.')
      }

      const currentContents = await readFile(filePath, 'utf8')
      if (currentContents !== this.state.originalEditorText) {
        throw new Error(
          'This file changed on disk after the editor opened. Cancel and reopen it to edit the latest version.'
        )
      }

      await writeFile(filePath, this.state.editorText, 'utf8')

      if (this.props.file.id !== fileID) {
        return
      }

      this.resetEditorState()
      await this.props.dispatcher.refreshRepository(this.props.repository)
    } catch (error) {
      if (this.props.file.id !== fileID) {
        return
      }

      this.setState({
        isSavingEditor: false,
        editorError: this.getEditorErrorMessage(error),
      })
    }
  }

  private onEditorKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      this.onSaveEditFile()
    }
  }

  public render() {
    return (
      <div className="diff-container">
        <DiffHeader
          path={this.props.file.path}
          status={this.props.file.status}
          diff={this.props.diff}
          showSideBySideDiff={this.props.showSideBySideDiff}
          onShowSideBySideDiffChanged={this.onShowSideBySideDiffChanged}
          hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
          onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
          onDiffOptionsOpened={this.props.onDiffOptionsOpened}
          canEditFile={this.canEditFile}
          isEditingFile={this.state.isEditingFile}
          onEditFile={this.onEditFile}
          canPreviewFile={this.canPreviewFile}
          isPreviewingFile={this.isPreviewingFile}
          onTogglePreviewFile={this.onTogglePreviewFile}
        />

        {this.renderContents()}
      </div>
    )
  }

  private get isPreviewingFile() {
    return this.state.isPreviewingFile && this.canPreviewFile
  }

  private renderContents() {
    if (this.state.isEditingFile) {
      return this.renderEditor()
    }

    return this.isPreviewingFile ? this.renderPreview() : this.renderDiff()
  }

  private renderPreview() {
    return (
      <MarkdownPreview
        repository={this.props.repository}
        file={this.props.file}
        emoji={this.props.emoji}
        onMarkdownLinkClicked={this.onMarkdownLinkClicked}
      />
    )
  }

  private renderDiff() {
    return (
      <SeamlessDiffSwitcher
        repository={this.props.repository}
        imageDiffType={this.props.imageDiffType}
        file={this.props.file}
        readOnly={false}
        onIncludeChanged={this.onDiffLineIncludeChanged}
        onDiscardChanges={this.onDiscardChanges}
        diff={this.props.diff}
        hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
        showSideBySideDiff={this.props.showSideBySideDiff}
        showDiffCheckMarks={this.props.showDiffCheckMarks}
        askForConfirmationOnDiscardChanges={
          this.props.askForConfirmationOnDiscardChanges
        }
        onOpenBinaryFile={this.props.onOpenBinaryFile}
        onOpenSubmodule={this.props.onOpenSubmodule}
        onInitializeSubmodule={this.props.onInitializeSubmodule}
        onSyncSubmodule={this.props.onSyncSubmodule}
        onRollbackSubmodule={this.props.onRollbackSubmodule}
        onSubmoduleCommitted={this.onSubmoduleCommitted}
        onOpenInExternalEditor={path =>
          this.props.dispatcher.openInExternalEditor(path)
        }
        externalEditorLabel={this.props.externalEditorLabel}
        onChangeImageDiffType={this.props.onChangeImageDiffType}
        onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
      />
    )
  }

  private renderEditor() {
    const { editorError, editorText, isLoadingEditor, isSavingEditor } =
      this.state

    const statusText = isLoadingEditor
      ? 'Loading file…'
      : isSavingEditor
      ? 'Saving file…'
      : editorError ?? 'Editing working tree file'

    return (
      <div className="working-file-editor">
        <div className="working-file-editor-toolbar">
          <span
            className={
              editorError === null
                ? 'working-file-editor-status'
                : 'working-file-editor-status working-file-editor-error'
            }
          >
            {statusText}
          </span>
          <Button
            size="small"
            className="working-file-editor-action"
            onClick={this.onCancelEditFile}
            disabled={isSavingEditor}
          >
            <Octicon symbol={octicons.x} />
            Cancel
          </Button>
          <Button
            size="small"
            className="button-component-primary working-file-editor-action"
            onClick={this.onSaveEditFile}
            disabled={
              isLoadingEditor || isSavingEditor || !this.editorHasChanges
            }
          >
            <Octicon symbol={octicons.check} />
            Save
          </Button>
        </div>
        <TextArea
          ariaLabel="Edit file contents"
          autoFocus={true}
          disabled={isLoadingEditor || isSavingEditor}
          labelClassName="working-file-editor-textarea-label"
          textareaClassName="working-file-editor-textarea"
          value={editorText}
          onValueChanged={this.onEditorTextChanged}
          onKeyDown={this.onEditorKeyDown}
        />
      </div>
    )
  }

  private onShowSideBySideDiffChanged = (showSideBySideDiff: boolean) => {
    this.props.dispatcher.onShowSideBySideDiffChanged(showSideBySideDiff)
  }

  private onHideWhitespaceInDiffChanged = (hideWhitespaceInDiff: boolean) => {
    return this.props.dispatcher.onHideWhitespaceInChangesDiffChanged(
      hideWhitespaceInDiff,
      this.props.repository
    )
  }
}
