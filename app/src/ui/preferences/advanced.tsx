import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { LinkButton } from '../lib/link-button'
import { Button } from '../lib/button'
import { SamplesURL } from '../../lib/stats'
import { isWindowsOpenSSHAvailable } from '../../lib/ssh/ssh'
import { enableAutoSwitchOnChanges } from '../../lib/feature-flag'
import {
  IChatHistoryArchiveConfig,
  IChatHistoryArchiveLogEntry,
} from '../../models/chat-history-archive'
import { loadArchiveLog, clearArchiveLog } from '../../lib/chat-history-archive'

interface IAdvancedPreferencesProps {
  readonly useWindowsOpenSSH: boolean
  readonly optOutOfUsageTracking: boolean
  readonly useExternalCredentialHelper: boolean
  readonly repositoryIndicatorsEnabled: boolean
  readonly autoSwitchOnChangesEnabled: boolean
  readonly worktreesEnabled: boolean
  readonly madnessModeEnabled: boolean
  readonly showReflogTab: boolean
  readonly terminalOpenOnStartup: boolean
  readonly terminalFontSize: number
  readonly terminalCursorBlink: boolean
  readonly terminalScrollback: number
  readonly onUseWindowsOpenSSHChanged: (checked: boolean) => void
  readonly onOptOutofReportingChanged: (checked: boolean) => void
  readonly onUseExternalCredentialHelperChanged: (checked: boolean) => void
  readonly onRepositoryIndicatorsEnabledChanged: (enabled: boolean) => void
  readonly onAutoSwitchOnChangesEnabledChanged: (enabled: boolean) => void
  readonly onWorktreesEnabledChanged: (enabled: boolean) => void
  readonly onMadnessModeEnabledChanged: (enabled: boolean) => void
  readonly onShowReflogTabChanged: (value: boolean) => void
  readonly onTerminalOpenOnStartupChanged: (value: boolean) => void
  readonly onTerminalFontSizeChanged: (value: number) => void
  readonly onTerminalCursorBlinkChanged: (value: boolean) => void
  readonly onTerminalScrollbackChanged: (value: number) => void
  // Chat History Archive (merged)
  readonly chatHistoryArchiveConfig: IChatHistoryArchiveConfig
  readonly onChatHistoryArchiveConfigChanged: (
    config: IChatHistoryArchiveConfig
  ) => void
}

interface IAdvancedPreferencesState {
  readonly optOutOfUsageTracking: boolean
  readonly canUseWindowsSSH: boolean
  readonly useExternalCredentialHelper: boolean
  readonly archiveLog: ReadonlyArray<IChatHistoryArchiveLogEntry>
}

export class Advanced extends React.Component<
  IAdvancedPreferencesProps,
  IAdvancedPreferencesState
> {
  public constructor(props: IAdvancedPreferencesProps) {
    super(props)

    this.state = {
      optOutOfUsageTracking: this.props.optOutOfUsageTracking,
      canUseWindowsSSH: false,
      useExternalCredentialHelper: this.props.useExternalCredentialHelper,
      archiveLog: [],
    }
  }

  public componentDidMount() {
    this.checkSSHAvailability()
    this.setState({ archiveLog: loadArchiveLog() })
  }

  private async checkSSHAvailability() {
    this.setState({ canUseWindowsSSH: await isWindowsOpenSSHAvailable() })
  }

  private onReportingOptOutChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = !event.currentTarget.checked

    this.setState({ optOutOfUsageTracking: value })
    this.props.onOptOutofReportingChanged(value)
  }

  private onUseExternalCredentialHelperChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    const value = event.currentTarget.checked

    this.setState({ useExternalCredentialHelper: value })
    this.props.onUseExternalCredentialHelperChanged(value)
  }

  private onRepositoryIndicatorsEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onRepositoryIndicatorsEnabledChanged(event.currentTarget.checked)
  }

  private onAutoSwitchOnChangesEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onAutoSwitchOnChangesEnabledChanged(event.currentTarget.checked)
  }

  private onShowReflogTabChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onShowReflogTabChanged(event.currentTarget.checked)
  }

  private onWorktreesEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onWorktreesEnabledChanged(event.currentTarget.checked)
  }

  private onMadnessModeEnabledChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onMadnessModeEnabledChanged(event.currentTarget.checked)
  }

  private onTerminalOpenOnStartupChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onTerminalOpenOnStartupChanged(event.currentTarget.checked)
  }

  private onTerminalCursorBlinkChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onTerminalCursorBlinkChanged(event.currentTarget.checked)
  }

  private onTerminalFontSizeChanged = (value: string) => {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 8 && n <= 32) {
      this.props.onTerminalFontSizeChanged(n)
    }
  }

  private onTerminalScrollbackChanged = (value: string) => {
    const n = parseInt(value, 10)
    if (!isNaN(n) && n >= 100 && n <= 100000) {
      this.props.onTerminalScrollbackChanged(n)
    }
  }

  private onUseWindowsOpenSSHChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onUseWindowsOpenSSHChanged(event.currentTarget.checked)
  }

  private reportDesktopUsageLabel() {
    return (
      <span>
        Help Madness Desktop improve by submitting{' '}
        <LinkButton uri={SamplesURL}>usage stats</LinkButton>
      </span>
    )
  }

  public render() {
    return (
      <DialogContent>
        <div className="advanced-section">
          <h2>Background updates</h2>
          <Checkbox
            label="Show status icons in the repository list"
            value={
              this.props.repositoryIndicatorsEnabled
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onRepositoryIndicatorsEnabledChanged}
            ariaDescribedBy="periodic-fetch-description"
          />
          <div id="periodic-fetch-description" className="settings-description">
            <p>
              These icons indicate which repositories have local or remote
              changes, and require the periodic fetching of repositories that
              are not currently selected.
            </p>
            <p>
              Turning this off will not stop the periodic fetching of your
              currently selected repository, but may improve overall app
              performance for users with many repositories.
            </p>
          </div>
          {enableAutoSwitchOnChanges() && (
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
          )}
          {enableAutoSwitchOnChanges() && (
            <div
              id="auto-switch-description"
              className="git-settings-description"
            >
              <p>
                When enabled, the app will poll repositories every 15 seconds
                and automatically switch to whichever repo gains new changes.
                Will not switch if your current repo has uncommitted work.
              </p>
            </div>
          )}
        </div>
        <div className="advanced-section">
          <h2>Repository view</h2>
          <Checkbox
            label="Show Reflog tab in repository sidebar"
            value={
              this.props.showReflogTab ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onShowReflogTabChanged}
          />
          <Checkbox
            label="Enable worktrees"
            value={
              this.props.worktreesEnabled ? CheckboxValue.On : CheckboxValue.Off
            }
            onChange={this.onWorktreesEnabledChanged}
            ariaDescribedBy="worktrees-enabled-description"
          />
          <div
            id="worktrees-enabled-description"
            className="git-settings-description"
          >
            <p>
              Shows the worktree dropdown in the toolbar and worktree actions in
              the menu. Turning this off switches the current repository back to
              its main worktree first, so you won't be stranded on a linked
              worktree.
            </p>
          </div>
          <Checkbox
            label="Madness Mode"
            value={
              this.props.madnessModeEnabled
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onMadnessModeEnabledChanged}
            ariaDescribedBy="madness-mode-enabled-description"
          />
          <div
            id="madness-mode-enabled-description"
            className="git-settings-description"
          >
            <p>
              Unlock power-user git controls. Every power action previews its
              git command and how to undo it.
            </p>
          </div>
        </div>
        <div className="advanced-section">
          <h2>Integrated terminal</h2>
          <Checkbox
            label="Show terminal on startup"
            value={
              this.props.terminalOpenOnStartup
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onTerminalOpenOnStartupChanged}
          />
          <Checkbox
            label="Cursor blink"
            value={
              this.props.terminalCursorBlink
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onTerminalCursorBlinkChanged}
          />
          <TextBox
            label="Font size (8–32)"
            value={String(this.props.terminalFontSize)}
            onValueChanged={this.onTerminalFontSizeChanged}
          />
          <TextBox
            label="Scrollback lines (100–100000)"
            value={String(this.props.terminalScrollback)}
            onValueChanged={this.onTerminalScrollbackChanged}
          />
        </div>
        <div className="advanced-section">
          <h2>Usage</h2>
          <Checkbox
            label={this.reportDesktopUsageLabel()}
            value={
              this.state.optOutOfUsageTracking
                ? CheckboxValue.Off
                : CheckboxValue.On
            }
            onChange={this.onReportingOptOutChanged}
          />
        </div>
        <h2>Network and credentials</h2>
        {this.renderSSHSettings()}
        <div className="advanced-section">
          <Checkbox
            label={'Use Git Credential Manager'}
            value={
              this.state.useExternalCredentialHelper
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onUseExternalCredentialHelperChanged}
            ariaDescribedBy="use-external-credential-helper-description"
          />
          <div
            id="use-external-credential-helper-description"
            className="settings-description"
          >
            <p>
              Use{' '}
              <LinkButton uri="https://gh.io/gcm">
                Git Credential Manager{' '}
              </LinkButton>{' '}
              for private repositories outside of GitHub.com. This feature is
              experimental and subject to change.
            </p>
          </div>
        </div>
        {this.renderChatHistoryArchive()}
      </DialogContent>
    )
  }

  // ─── Chat History Archive ──────────────────────────────────────────────────

  private onArchiveEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onChatHistoryArchiveConfigChanged({
      ...this.props.chatHistoryArchiveConfig,
      enabled: (e.currentTarget as HTMLInputElement).checked,
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
    const autoCommit = (e.currentTarget as HTMLInputElement).checked
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
      autoPush: (e.currentTarget as HTMLInputElement).checked,
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

  private renderSSHSettings() {
    if (!this.state.canUseWindowsSSH) {
      return null
    }

    return (
      <div className="advanced-section">
        <Checkbox
          label="Use system OpenSSH (recommended)"
          value={
            this.props.useWindowsOpenSSH ? CheckboxValue.On : CheckboxValue.Off
          }
          onChange={this.onUseWindowsOpenSSHChanged}
        />
      </div>
    )
  }
}
