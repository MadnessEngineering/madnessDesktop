import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { enableAutoSwitchOnChanges } from '../../lib/feature-flag'
import { IAutoIgnoreConfig } from '../../models/auto-ignore'
import {
  IChatHistoryArchiveConfig,
  IChatHistoryArchiveLogEntry,
} from '../../models/chat-history-archive'
import { loadArchiveLog, clearArchiveLog } from '../../lib/chat-history-archive'
import { AutoIgnorePreferences } from './auto-ignore'

/**
 * Everything the app does by itself, in one tab (todo a8c1b611, Dan's pick):
 * Auto-Ignore, the Chat History Archive and auto-switch, each with its own
 * switch, plus the way to the agent hooks. The archive and auto-switch used to
 * sit in Advanced; Auto-Ignore had a tab of its own.
 */
interface IAutomationPreferencesProps {
  readonly autoIgnoreConfig: IAutoIgnoreConfig
  readonly onAutoIgnoreConfigChanged: (config: IAutoIgnoreConfig) => void
  readonly chatHistoryArchiveConfig: IChatHistoryArchiveConfig
  readonly onChatHistoryArchiveConfigChanged: (
    config: IChatHistoryArchiveConfig
  ) => void
  readonly autoSwitchOnChangesEnabled: boolean
  readonly onAutoSwitchOnChangesEnabledChanged: (enabled: boolean) => void
  /** Switch the dialog to the Hooks tab. */
  readonly onOpenHooks: () => void
}

interface IAutomationPreferencesState {
  readonly archiveLog: ReadonlyArray<IChatHistoryArchiveLogEntry>
}

export class AutomationPreferences extends React.Component<
  IAutomationPreferencesProps,
  IAutomationPreferencesState
> {
  public constructor(props: IAutomationPreferencesProps) {
    super(props)
    this.state = { archiveLog: [] }
  }

  public componentDidMount() {
    this.setState({ archiveLog: loadArchiveLog() })
  }

  // ─── Auto-switch ───────────────────────────────────────────────────────────

  private onAutoSwitchOnChangesEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onAutoSwitchOnChangesEnabledChanged(event.currentTarget.checked)
  }

  // ─── Chat History Archive ──────────────────────────────────────────────────

  private onArchiveEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onChatHistoryArchiveConfigChanged({
      ...this.props.chatHistoryArchiveConfig,
      enabled: e.currentTarget.checked,
    })
  }

  private onArchivePathChanged = (value: string) => {
    this.props.onChatHistoryArchiveConfigChanged({
      ...this.props.chatHistoryArchiveConfig,
      archivePath: value,
    })
  }

  private onWatchDirsChanged = (value: string) => {
    const watchDirs = value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
    this.props.onChatHistoryArchiveConfigChanged({
      ...this.props.chatHistoryArchiveConfig,
      watchDirs,
    })
  }

  private onAutoCommitChanged = (e: React.FormEvent<HTMLInputElement>) => {
    const autoCommit = e.currentTarget.checked
    this.props.onChatHistoryArchiveConfigChanged({
      ...this.props.chatHistoryArchiveConfig,
      autoCommit,
      autoPush: autoCommit
        ? this.props.chatHistoryArchiveConfig.autoPush
        : false,
    })
  }

  private onAutoPushChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onChatHistoryArchiveConfigChanged({
      ...this.props.chatHistoryArchiveConfig,
      autoPush: e.currentTarget.checked,
    })
  }

  private onClearArchiveLog = () => {
    clearArchiveLog()
    this.setState({ archiveLog: loadArchiveLog() })
  }

  private renderChatHistoryArchive() {
    const { chatHistoryArchiveConfig: config } = this.props
    const disabled = !config.enabled

    return (
      <div className="advanced-section">
        <h2>Chat History Archive</h2>
        <p className="git-settings-description">
          Automatically detect and centralize AI conversation history from
          tracked repositories.
        </p>

        <Checkbox
          label="Enable background chat history archiving"
          value={config.enabled ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onArchiveEnabledChanged}
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

        {this.state.archiveLog.length > 0 && (
          <div className="chat-history-archive-history">
            <h3>Archive History</h3>
            <div
              className="chat-history-log-list"
              style={{ maxHeight: '200px', overflow: 'auto' }}
            >
              {this.state.archiveLog.map((entry, index) => (
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
            <Button onClick={this.onClearArchiveLog}>Clear Log</Button>
          </div>
        )}
      </div>
    )
  }

  private renderAutoSwitch() {
    if (!enableAutoSwitchOnChanges()) {
      return null
    }
    return (
      <div className="advanced-section">
        <h2>Auto-switch</h2>
        <Checkbox
          label="Auto-switch to repositories with new changes"
          value={
            this.props.autoSwitchOnChangesEnabled
              ? CheckboxValue.On
              : CheckboxValue.Off
          }
          onChange={this.onAutoSwitchOnChangesEnabledChanged}
          ariaDescribedBy="auto-switch-description"
        />
        <div id="auto-switch-description" className="git-settings-description">
          <p>
            When enabled, the app will poll repositories every 15 seconds and
            automatically switch to whichever repo gains new changes. Will not
            switch if your current repo has uncommitted work.
          </p>
        </div>
      </div>
    )
  }

  private renderHooks() {
    return (
      <div className="advanced-section">
        <h2>Hooks</h2>
        <p className="git-settings-description">
          Agent hooks and hook loadouts have their own tab.{' '}
          <LinkButton onClick={this.props.onOpenHooks}>Open Hooks</LinkButton>
        </p>
      </div>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="advanced-section">
          <AutoIgnorePreferences
            embedded={true}
            config={this.props.autoIgnoreConfig}
            onConfigChanged={this.props.onAutoIgnoreConfigChanged}
          />
        </div>
        {this.renderChatHistoryArchive()}
        {this.renderAutoSwitch()}
        {this.renderHooks()}
      </DialogContent>
    )
  }
}
