import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  IAutoIgnoreConfig,
  IAutoIgnoreLogEntry,
  DefaultAutoIgnoreConfig,
} from '../../models/auto-ignore'
import {
  formatAutoIgnoreCommitMessage,
  isValidStandardPattern,
  matchStandardPattern,
} from '../../lib/auto-ignore'
import {
  clearAutoIgnoreLog,
  loadAutoIgnoreLog,
} from '../../lib/auto-ignore-log'

interface IAutoIgnorePreferencesProps {
  readonly config: IAutoIgnoreConfig
  readonly onConfigChanged: (config: IAutoIgnoreConfig) => void
  /** Inside the Automation tab's DialogContent: render without its own. */
  readonly embedded?: boolean
}

interface IAutoIgnorePreferencesState {
  readonly newPattern: string
  readonly testPath: string
  readonly log: ReadonlyArray<IAutoIgnoreLogEntry>
}

interface IPatternRowProps {
  readonly pattern: string
  readonly onRemove: (pattern: string) => void
}

/** Own component so the remove handler isn't an arrow in JSX. */
class PatternRow extends React.Component<IPatternRowProps> {
  private onRemove = () => this.props.onRemove(this.props.pattern)

  public render() {
    return (
      <li>
        <code>{this.props.pattern}</code>
        <Button size="small" onClick={this.onRemove}>
          Remove
        </Button>
      </li>
    )
  }
}

export class AutoIgnorePreferences extends React.Component<
  IAutoIgnorePreferencesProps,
  IAutoIgnorePreferencesState
> {
  public constructor(props: IAutoIgnorePreferencesProps) {
    super(props)
    this.state = { newPattern: '', testPath: '', log: [] }
  }

  public componentDidMount() {
    this.setState({ log: loadAutoIgnoreLog() })
  }

  private update(partial: Partial<IAutoIgnoreConfig>) {
    this.props.onConfigChanged({ ...this.props.config, ...partial })
  }

  private onEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.update({ enabled: e.currentTarget.checked })
  }

  private onAutoCommitChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.update({ autoCommit: e.currentTarget.checked })
  }

  private onCommitMessageChanged = (commitMessage: string) =>
    this.update({ commitMessage })

  private onResetCommitMessage = () =>
    this.update({ commitMessage: DefaultAutoIgnoreConfig.commitMessage })

  private onNewPatternChanged = (newPattern: string) =>
    this.setState({ newPattern })

  // Enter would otherwise submit (and close) the settings dialog.
  private onNewPatternKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      this.onAddPattern()
    }
  }

  private newPatternError(): string | null {
    const pattern = this.state.newPattern.trim()
    if (pattern.length === 0) {
      return null
    }
    if (!isValidStandardPattern(pattern)) {
      return 'Use a single name: name/ (folder), name, or *.ext. No slashes inside, no leading ! or #.'
    }
    if (this.props.config.patterns.includes(pattern)) {
      return 'Already in the list.'
    }
    return null
  }

  private onAddPattern = () => {
    const pattern = this.state.newPattern.trim()
    if (pattern.length === 0 || this.newPatternError() !== null) {
      return
    }
    this.update({ patterns: [...this.props.config.patterns, pattern] })
    this.setState({ newPattern: '' })
  }

  private onRemovePattern = (pattern: string) => {
    this.update({
      patterns: this.props.config.patterns.filter(p => p !== pattern),
    })
  }

  private onTestPathChanged = (testPath: string) => this.setState({ testPath })

  private onClearLog = () => {
    clearAutoIgnoreLog()
    this.setState({ log: [] })
  }

  private renderBehaviour() {
    const { config } = this.props
    return (
      <div className="auto-ignore-section">
        <h2>Standard Ignore Patterns</h2>
        <p className="auto-ignore-description">
          When a repository's only changes are untracked files matching one of
          these patterns, the pattern is added to its root .gitignore. Any other
          change in the repository and nothing happens. Nothing is pushed by the
          app (your repository's own hooks still run).
        </p>

        <Checkbox
          label="Auto-ignore standard patterns"
          value={config.enabled ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onEnabledChanged}
        />
        <Checkbox
          label="Commit the .gitignore change on its own"
          value={config.autoCommit ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onAutoCommitChanged}
          disabled={!config.enabled}
        />
      </div>
    )
  }

  private renderPatterns() {
    const { config } = this.props
    const error = this.newPatternError()

    return (
      <div className="auto-ignore-section">
        <h2>Patterns</h2>
        <p className="auto-ignore-description">
          Each pattern matches at any depth: <code>.claude_temp/</code> covers
          every <code>.claude_temp</code> folder. You can also add one from a
          file's context menu with "Always Ignore".
        </p>

        {config.patterns.length === 0 ? (
          <p className="auto-ignore-empty">No patterns yet.</p>
        ) : (
          <ul className="auto-ignore-patterns">
            {config.patterns.map(pattern => (
              <PatternRow
                key={pattern}
                pattern={pattern}
                onRemove={this.onRemovePattern}
              />
            ))}
          </ul>
        )}

        <div className="auto-ignore-add-row">
          <TextBox
            placeholder=".claude_temp/ or *.log"
            value={this.state.newPattern}
            onValueChanged={this.onNewPatternChanged}
            onKeyDown={this.onNewPatternKeyDown}
          />
          <Button
            onClick={this.onAddPattern}
            disabled={this.state.newPattern.trim().length === 0 || !!error}
          >
            Add
          </Button>
        </div>
        {error && <p className="auto-ignore-error">{error}</p>}

        <div className="auto-ignore-test">
          <TextBox
            label="Test a path"
            placeholder="app/src/ui/lib/.claude_temp/last_tool_use_id.txt"
            value={this.state.testPath}
            onValueChanged={this.onTestPathChanged}
          />
          {this.renderTestResult()}
        </div>
      </div>
    )
  }

  private renderTestResult() {
    const path = this.state.testPath.trim()
    if (path.length === 0) {
      return null
    }
    const match = this.props.config.patterns.find(p =>
      matchStandardPattern(path, p)
    )
    return match === undefined ? (
      <p className="auto-ignore-test-result miss">No pattern matches.</p>
    ) : (
      <p className="auto-ignore-test-result hit">
        Matched by <code>{match}</code>
      </p>
    )
  }

  private renderCommitMessage() {
    const { config } = this.props
    const examplePatterns =
      config.patterns.length > 0 ? config.patterns.slice(0, 2) : ['name/']

    return (
      <div className="auto-ignore-section">
        <h2>Commit Message</h2>
        <div className="auto-ignore-add-row">
          <TextBox
            value={config.commitMessage}
            onValueChanged={this.onCommitMessageChanged}
            placeholder={DefaultAutoIgnoreConfig.commitMessage}
            disabled={!config.enabled || !config.autoCommit}
          />
          <Button
            onClick={this.onResetCommitMessage}
            disabled={
              config.commitMessage === DefaultAutoIgnoreConfig.commitMessage
            }
          >
            Reset
          </Button>
        </div>
        <p className="auto-ignore-description">
          <code>{'{patterns}'}</code> becomes the rules that were added.
          Preview:{' '}
          <code>
            {formatAutoIgnoreCommitMessage(
              config.commitMessage,
              examplePatterns
            )}
          </code>
        </p>
      </div>
    )
  }

  private renderLog() {
    const entries = [...this.state.log].reverse()
    return (
      <div className="auto-ignore-section">
        <h2>Recent Activity</h2>
        {entries.length === 0 ? (
          <p className="auto-ignore-empty">Nothing auto-ignored yet.</p>
        ) : (
          <>
            <ul className="auto-ignore-log">
              {entries.map((entry, i) => (
                <li key={i} className={`outcome-${entry.outcome}`}>
                  <span className="auto-ignore-log-outcome">
                    {entry.outcome}
                  </span>{' '}
                  <strong>{entry.repository}</strong>{' '}
                  <code>{entry.patterns.join(', ')}</code>
                  {entry.sha && <code> {entry.sha.slice(0, 10)}</code>}
                  {entry.detail && (
                    <span className="auto-ignore-log-detail">
                      {' '}
                      ({entry.detail})
                    </span>
                  )}
                  <div className="auto-ignore-log-time">
                    {new Date(entry.timestamp).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
            <Button onClick={this.onClearLog}>Clear Activity</Button>
          </>
        )}
      </div>
    )
  }

  public render() {
    const body = (
      <div className="auto-ignore-preferences">
        {this.renderBehaviour()}
        {this.renderPatterns()}
        {this.renderCommitMessage()}
        {this.renderLog()}
      </div>
    )
    return this.props.embedded ? body : <DialogContent>{body}</DialogContent>
  }
}
