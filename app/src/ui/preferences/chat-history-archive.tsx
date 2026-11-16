// Not rendered anywhere: these settings show in another Settings tab now.
// Kept on purpose (Dan, 2026-11-15, todo a8c1b611), not dead code: don't delete
// it in a cleanup. The why is Dan's to add here.

import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  IChatHistoryArchiveConfig,
  IChatHistoryArchiveLogEntry,
} from '../../models/chat-history-archive'
import {
  loadArchiveLog,
  clearArchiveLog,
} from '../../lib/chat-history-archive'
import { Button } from '../lib/button'

interface IChatHistoryArchivePreferencesProps {
  readonly config: IChatHistoryArchiveConfig
  readonly onConfigChanged: (config: IChatHistoryArchiveConfig) => void
}

interface IChatHistoryArchivePreferencesState {
  readonly log: ReadonlyArray<IChatHistoryArchiveLogEntry>
}

export class ChatHistoryArchivePreferences extends React.Component<
  IChatHistoryArchivePreferencesProps,
  IChatHistoryArchivePreferencesState
> {
  public constructor(props: IChatHistoryArchivePreferencesProps) {
    super(props)
    this.state = { log: [] }
  }

  public componentDidMount() {
    this.setState({ log: loadArchiveLog() })
  }

  private onEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onConfigChanged({
      ...this.props.config,
      enabled: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onArchivePathChanged = (value: string) => {
    this.props.onConfigChanged({
      ...this.props.config,
      archivePath: value,
    })
  }

  private onWatchDirsChanged = (value: string) => {
    const watchDirs = value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
    this.props.onConfigChanged({
      ...this.props.config,
      watchDirs,
    })
  }

  private onAutoCommitChanged = (e: React.FormEvent<HTMLInputElement>) => {
    const autoCommit = (e.currentTarget as HTMLInputElement).checked
    this.props.onConfigChanged({
      ...this.props.config,
      autoCommit,
      autoPush: autoCommit ? this.props.config.autoPush : false,
    })
  }

  private onAutoPushChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onConfigChanged({
      ...this.props.config,
      autoPush: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onClearLog = () => {
    clearArchiveLog()
    this.setState({ log: loadArchiveLog() })
  }

  public render() {
    const { config } = this.props
    const disabled = !config.enabled

    return (
      <DialogContent>
        <div className="chat-history-archive-preferences-section">
          <h2>Chat History Archive</h2>
          <p className="git-settings-description">
            Automatically detect and centralize AI conversation history from
            tracked repositories.
          </p>

          <Checkbox
            label="Enable background chat history archiving"
            value={config.enabled ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onEnabledChanged}
          />

          <TextBox
            label="Archive Path"
            value={config.archivePath}
            onValueChanged={this.onArchivePathChanged}
            placeholder="/path/to/archive/repo"
            disabled={disabled}
          />

          <TextBox
            label="Watch Directories"
            value={config.watchDirs.join(', ')}
            onValueChanged={this.onWatchDirsChanged}
            placeholder=".specstory/history, .claude"
            disabled={disabled}
          />

          <Checkbox
            label="Auto-commit after archiving"
            value={config.autoCommit ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onAutoCommitChanged}
            disabled={disabled}
          />

          <Checkbox
            label="Auto-push after commit"
            value={config.autoPush ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onAutoPushChanged}
            disabled={disabled || !config.autoCommit}
          />

          <div className="chat-history-archive-history">
            <h3>Archive History</h3>
            <div
              className="chat-history-log-list"
              style={{ maxHeight: '200px', overflow: 'auto' }}
            >
              {this.state.log.map((entry, index) => (
                <div key={index} className="chat-history-log-entry">
                  <div>{new Date(entry.timestamp).toLocaleString()}</div>
                  <div>{entry.repos.join(', ')}</div>
                  <div>
                    {entry.archived} archived,{' '}
                    <span
                      style={entry.failed > 0 ? { color: 'red' } : undefined}
                    >
                      {entry.failed} failed
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <Button onClick={this.onClearLog}>Clear Log</Button>
          </div>
        </div>
      </DialogContent>
    )
  }
}
