import * as React from 'react'
import { readFile, writeFile } from 'fs/promises'
import { Button } from '../lib/button'
import { showOpenDialog, showSaveDialog } from '../main-process-proxy'
import {
  collectSettings,
  ISettingsFile,
  parseSettingsFile,
} from '../../lib/settings-transfer'

// Export / import the portable settings as a JSON file, to carry them to
// another machine (todo a8c1b611). What travels: lib/settings-transfer.ts.
interface ISettingsFileSectionProps {
  /**
   * Close Settings without saving, then write the file's settings: the
   * dialog's Save would otherwise write its own values back over them.
   */
  readonly onApplySettingsFile: (file: ISettingsFile) => void
}

interface ISettingsFileSectionState {
  readonly message: string | null
  readonly error: string | null
  readonly pending: ISettingsFile | null
}

export class SettingsFileSection extends React.Component<
  ISettingsFileSectionProps,
  ISettingsFileSectionState
> {
  public constructor(props: ISettingsFileSectionProps) {
    super(props)
    this.state = { message: null, error: null, pending: null }
  }

  private onExport = async () => {
    const path = await showSaveDialog({
      buttonLabel: 'Export',
      defaultPath: 'madness-desktop-settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (path == null) {
      return
    }
    try {
      const file = collectSettings(localStorage)
      await writeFile(path, JSON.stringify(file, null, 2) + '\n', 'utf8')
      const count = Object.keys(file.settings).length
      this.setState({
        message: `Saved ${count} settings to ${path}.`,
        error: null,
        pending: null,
      })
    } catch (e) {
      this.setState({ message: null, error: `Couldn't save the file: ${e}` })
    }
  }

  private onImport = async () => {
    const path = await showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (path === null) {
      return
    }
    try {
      const pending = parseSettingsFile(await readFile(path, 'utf8'))
      this.setState({ pending, message: null, error: null })
    } catch (e) {
      this.setState({
        pending: null,
        message: null,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  private onApply = () => {
    if (this.state.pending !== null) {
      this.props.onApplySettingsFile(this.state.pending)
    }
  }

  private onCancelImport = () => this.setState({ pending: null })

  private renderPending(pending: ISettingsFile) {
    const count = Object.keys(pending.settings).length
    const when = new Date(pending.exportedAt)
    const exported = isNaN(when.getTime())
      ? ''
      : ` from ${when.toLocaleString()}`
    return (
      <div className="settings-file-pending">
        <p>
          Found {count} settings{exported}. Applying closes Settings without
          saving; restart Madness Desktop to see them.
        </p>
        <Button onClick={this.onApply}>Apply and close Settings</Button>
        <Button onClick={this.onCancelImport}>Cancel</Button>
      </div>
    )
  }

  public render() {
    const { message, error, pending } = this.state
    return (
      <div className="advanced-section">
        <h2>Settings file</h2>
        <p className="git-settings-description">
          Carry these settings to another machine. API keys and passwords stay
          here, and so do paths that only make sense on this machine.
        </p>
        <Button onClick={this.onExport}>Export settings…</Button>
        <Button onClick={this.onImport}>Import settings…</Button>
        {message !== null && <p className="settings-file-message">{message}</p>}
        {error !== null && (
          <p className="settings-file-error" role="alert">
            {error}
          </p>
        )}
        {pending !== null && this.renderPending(pending)}
      </div>
    )
  }
}
