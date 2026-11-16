// Not rendered anywhere: these settings show in another Settings tab now.
// Kept on purpose (Dan, 2026-11-15, todo a8c1b611), not dead code: don't delete
// it in a cleanup. The why is Dan's to add here.

import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import {
  ILocalAIConfig,
  LocalAIProvider,
  DefaultLocalAIConfigs,
  LocalAIPromptMode,
} from '../../models/local-ai'
import { testLocalAIConnection } from '../../lib/local-ai-commit-message'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

interface ILocalAIPreferencesProps {
  readonly config: ILocalAIConfig
  readonly onConfigChanged: (config: ILocalAIConfig) => void
  readonly showSecuritySettings?: boolean
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; models: ReadonlyArray<string> }
  | { kind: 'error'; message: string }

interface ILocalAIPreferencesState {
  readonly testStatus: TestStatus
}

export class LocalAIPreferences extends React.Component<
  ILocalAIPreferencesProps,
  ILocalAIPreferencesState
> {
  public constructor(props: ILocalAIPreferencesProps) {
    super(props)
    this.state = { testStatus: { kind: 'idle' } }
  }

  private onEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onConfigChanged({
      ...this.props.config,
      enabled: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onAllowNonLocalHttpChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onConfigChanged({
      ...this.props.config,
      allowNonLocalHttp: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onSanitizeGitContextChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onConfigChanged({
      ...this.props.config,
      sanitizeGitContext: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onProviderChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.currentTarget.value as LocalAIProvider
    const defaults = DefaultLocalAIConfigs[provider]
    this.props.onConfigChanged({
      ...this.props.config,
      provider,
      baseUrl: defaults.baseUrl ?? this.props.config.baseUrl,
      modelId: defaults.modelId ?? this.props.config.modelId,
    })
    this.setState({ testStatus: { kind: 'idle' } })
  }

  private onBaseUrlChanged = (value: string) => {
    this.props.onConfigChanged({ ...this.props.config, baseUrl: value })
    this.setState({ testStatus: { kind: 'idle' } })
  }

  private onModelIdChanged = (value: string) => {
    this.props.onConfigChanged({ ...this.props.config, modelId: value })
  }

  private onModelSelectChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
    this.props.onConfigChanged({
      ...this.props.config,
      modelId: e.currentTarget.value,
    })
  }

  private onPromptModeChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
    this.props.onConfigChanged({
      ...this.props.config,
      promptMode: e.currentTarget.value as LocalAIPromptMode,
    })
  }

  private onCustomSystemPromptChanged = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.props.onConfigChanged({
      ...this.props.config,
      customSystemPrompt: e.currentTarget.value,
    })
  }

  private onTestConnection = async () => {
    this.setState({ testStatus: { kind: 'testing' } })
    try {
      const models = await testLocalAIConnection(
        this.props.config.baseUrl,
        this.props.config.allowNonLocalHttp
      )
      // Auto-select first model if current modelId isn't in the list
      if (models.length > 0 && !models.includes(this.props.config.modelId)) {
        this.props.onConfigChanged({
          ...this.props.config,
          modelId: models[0],
        })
      }
      this.setState({ testStatus: { kind: 'success', models } })
    } catch (e) {
      this.setState({
        testStatus: {
          kind: 'error',
          message: e instanceof Error ? e.message : 'Connection failed',
        },
      })
    }
  }

  private renderModelField() {
    const { config } = this.props
    const { testStatus } = this.state
    const disabled = !config.enabled

    // If we have a model list from a successful test, show dropdown
    if (testStatus.kind === 'success' && testStatus.models.length > 0) {
      return (
        <div className="local-ai-field-row">
          <label htmlFor="local-ai-model">Model</label>
          <select
            id="local-ai-model"
            value={config.modelId}
            onChange={this.onModelSelectChanged}
            disabled={disabled}
          >
            {testStatus.models.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )
    }

    // Fallback: manual text input
    return (
      <TextBox
        label="Model ID"
        value={config.modelId}
        onValueChanged={this.onModelIdChanged}
        placeholder="local-model"
        disabled={disabled}
      />
    )
  }

  private renderTestStatus() {
    const { testStatus } = this.state
    if (testStatus.kind === 'idle' || testStatus.kind === 'testing') {
      return null
    }
    if (testStatus.kind === 'success') {
      return (
        <span className="local-ai-test-status local-ai-test-ok">
          ✓ {testStatus.models.length} model
          {testStatus.models.length !== 1 ? 's' : ''} available
        </span>
      )
    }
    return (
      <span className="local-ai-test-status local-ai-test-error">
        ✗ {testStatus.message}
      </span>
    )
  }

  public render() {
    const { config, showSecuritySettings } = this.props
    const { testStatus } = this.state
    const testing = testStatus.kind === 'testing'
    const disabled = !config.enabled

    return (
      <DialogContent>
        <div className="local-ai-preferences-section">
          <h2>Local AI</h2>
          <p className="git-settings-description">
            Generate commit messages using a locally running model via Ollama or
            LM Studio. The model needs to be running before you can use this
            feature.
          </p>

          <Checkbox
            label="Enable local AI commit message generation"
            value={config.enabled ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onEnabledChanged}
          />

          <div className="local-ai-field-row">
            <label htmlFor="local-ai-provider">Provider</label>
            <select
              id="local-ai-provider"
              value={config.provider}
              onChange={this.onProviderChanged}
              disabled={disabled}
            >
              <option value="lmstudio">LM Studio</option>
              <option value="ollama">Ollama</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <TextBox
            label="Base URL"
            value={config.baseUrl}
            onValueChanged={this.onBaseUrlChanged}
            placeholder="http://localhost:1234"
            disabled={disabled}
          />

          {this.renderModelField()}

          <div className="local-ai-test-row">
            <Button
              onClick={this.onTestConnection}
              disabled={testing || disabled || !config.baseUrl.trim()}
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
            {this.renderTestStatus()}
          </div>

          <div className="local-ai-field-row">
            <label htmlFor="local-ai-prompt-mode">Prompt Mode</label>
            <select
              id="local-ai-prompt-mode"
              value={config.promptMode}
              onChange={this.onPromptModeChanged}
              disabled={disabled}
            >
              <option value="default">Default</option>
              <option value="conventional">Conventional Commits</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {config.promptMode === 'custom' && (
            <div className="local-ai-field-row">
              <label htmlFor="local-ai-custom-prompt">
                Custom System Prompt
              </label>
              <textarea
                id="local-ai-custom-prompt"
                className="local-ai-custom-prompt"
                value={config.customSystemPrompt}
                onChange={this.onCustomSystemPromptChanged}
                placeholder="Enter your system prompt..."
                rows={6}
                disabled={disabled}
              />
            </div>
          )}

          {showSecuritySettings && (
            <React.Fragment>
              <Checkbox
                label="Allow non-local HTTP endpoints"
                value={
                  config.allowNonLocalHttp
                    ? CheckboxValue.On
                    : CheckboxValue.Off
                }
                onChange={this.onAllowNonLocalHttpChanged}
                disabled={disabled}
              />
              <Checkbox
                label="Sanitize git context in prompts"
                value={
                  config.sanitizeGitContext
                    ? CheckboxValue.On
                    : CheckboxValue.Off
                }
                onChange={this.onSanitizeGitContextChanged}
                disabled={disabled}
              />
            </React.Fragment>
          )}

          <p className="git-settings-description">
            Uses the OpenAI-compatible <code>/v1/chat/completions</code>{' '}
            endpoint. Works with LM Studio (port 1234) and Ollama (port 11434).
          </p>
        </div>
      </DialogContent>
    )
  }
}
