import * as React from 'react'
import { DialogContent } from '../dialog'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { invokeProxy } from '../main-process-proxy'
import type {
  OmnispindleTestResult,
  MadnessSignInResult,
  MadnessSignInStep,
} from '../../models/omnispindle'
import {
  ILocalAIConfig,
  LocalAIProvider,
  DefaultLocalAIConfigs,
  LocalAIPromptMode,
} from '../../models/local-ai'
import { testLocalAIConnection } from '../../lib/local-ai-commit-message'

interface IAIServicesPreferencesProps {
  // Omnispindle
  readonly apiKey: string
  readonly onApiKeyChanged: (value: string) => void
  /** Combined GitHub + Madness Interactive sign-in (see Preferences). */
  readonly onMadnessSignIn: (
    onProgress: (step: MadnessSignInStep) => void
  ) => Promise<MadnessSignInResult>
  // Local AI
  readonly localAIConfig: ILocalAIConfig
  readonly onLocalAIConfigChanged: (config: ILocalAIConfig) => void
  readonly showSecuritySettings?: boolean
}

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'testing'; message?: string }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

type LocalAITestStatus =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; models: ReadonlyArray<string> }
  | { kind: 'error'; message: string }

interface IAIServicesPreferencesState {
  readonly omnispindleTestStatus: TestStatus
  readonly omnispindleSignInStatus: TestStatus
  readonly localAITestStatus: LocalAITestStatus
}

const testConnectionIpc = invokeProxy('omnispindle-test', 1)

export class AIServicesPreferences extends React.Component<
  IAIServicesPreferencesProps,
  IAIServicesPreferencesState
> {
  public constructor(props: IAIServicesPreferencesProps) {
    super(props)
    this.state = {
      omnispindleTestStatus: { kind: 'idle' },
      omnispindleSignInStatus: { kind: 'idle' },
      localAITestStatus: { kind: 'idle' },
    }
  }

  public componentDidUpdate(prevProps: IAIServicesPreferencesProps) {
    if (
      prevProps.apiKey !== this.props.apiKey &&
      this.state.omnispindleTestStatus.kind !== 'idle'
    ) {
      this.setState({ omnispindleTestStatus: { kind: 'idle' } })
    }
  }

  // ─── Omnispindle ───────────────────────────────────────────────────────────

  private onApiKeyChanged = (value: string) => {
    this.props.onApiKeyChanged(value)
  }

  private onTestOmnispindle = async () => {
    const { apiKey } = this.props
    if (!apiKey.trim()) {
      this.setState({
        omnispindleTestStatus: {
          kind: 'error',
          message: 'Enter an API key first',
        },
      })
      return
    }
    this.setState({ omnispindleTestStatus: { kind: 'testing' } })
    try {
      const result: OmnispindleTestResult = await testConnectionIpc(apiKey)
      if (result.status === 'connected') {
        this.setState({
          omnispindleTestStatus: {
            kind: 'success',
            message: result.message ?? 'Connected successfully',
          },
        })
      } else {
        this.setState({
          omnispindleTestStatus: {
            kind: 'error',
            message: result.message ?? 'Connection failed',
          },
        })
      }
    } catch (err) {
      this.setState({
        omnispindleTestStatus: {
          kind: 'error',
          message: err instanceof Error ? err.message : 'Connection failed',
        },
      })
    }
  }

  private onSignIn = async () => {
    this.setState({
      omnispindleSignInStatus: { kind: 'testing' },
    })
    const result = await this.props.onMadnessSignIn(step =>
      this.setState({
        omnispindleSignInStatus: {
          kind: 'testing',
          message:
            step === 'github'
              ? 'Finish signing in to GitHub in your browser…'
              : 'Finish signing in to Madness Interactive in your browser…',
        },
      })
    )

    if (result.kind === 'success') {
      // Preferences already copied a new key into its state (and so into the
      // API Key field), so there's nothing to set here.
      this.setState({
        omnispindleSignInStatus: {
          kind: 'success',
          message:
            result.apiKey !== null ? 'Signed in — API key saved' : 'Signed in',
        },
      })
    } else if (result.kind === 'error') {
      this.setState({
        omnispindleSignInStatus: { kind: 'error', message: result.message },
      })
    } else {
      this.setState({ omnispindleSignInStatus: { kind: 'idle' } })
    }
  }

  private renderStatusLine(status: TestStatus) {
    if (status.kind === 'idle') {
      return null
    }
    if (status.kind === 'testing') {
      return (
        <p className="omnispindle-test-status omnispindle-test-working">
          {status.message ?? 'Working…'}
        </p>
      )
    }
    if (status.kind === 'success') {
      return (
        <p className="omnispindle-test-status omnispindle-test-ok">
          ✓ {status.message}
        </p>
      )
    }
    return (
      <p className="omnispindle-test-status omnispindle-test-error">
        ✗ {status.message}
      </p>
    )
  }

  private renderOmnispindleTestStatus() {
    const { omnispindleTestStatus } = this.state
    if (omnispindleTestStatus.kind === 'idle') {
      return null
    }
    if (omnispindleTestStatus.kind === 'testing') {
      return (
        <p className="omnispindle-test-status omnispindle-test-working">
          Testing connection…
        </p>
      )
    }
    if (omnispindleTestStatus.kind === 'success') {
      return (
        <p className="omnispindle-test-status omnispindle-test-ok">
          ✓ {omnispindleTestStatus.message}
        </p>
      )
    }
    return (
      <p className="omnispindle-test-status omnispindle-test-error">
        ✗ {omnispindleTestStatus.message}
      </p>
    )
  }

  private renderOmnispindle() {
    const { apiKey } = this.props
    const testing = this.state.omnispindleTestStatus.kind === 'testing'
    const signingIn = this.state.omnispindleSignInStatus.kind === 'testing'

    return (
      <div className="omnispindle-preferences-section">
        <h2>Omnispindle</h2>
        <p className="git-settings-description">
          Connect to your Omnispindle MCP server to display active todos in the
          Changes sidebar.
        </p>

        <div className="omnispindle-test-row">
          <Button onClick={this.onSignIn} disabled={signingIn} type="submit">
            {signingIn ? 'Signing in…' : 'Sign in with Madness Interactive'}
          </Button>
          {this.renderStatusLine(this.state.omnispindleSignInStatus)}
        </div>
        <p className="git-settings-description">
          Signs you in to GitHub and Madness Interactive, and generates an API
          key automatically. Or paste one manually below.
        </p>

        <TextBox
          label="API Key"
          value={apiKey}
          onValueChanged={this.onApiKeyChanged}
          placeholder="omni_..."
          type="password"
        />

        <div className="omnispindle-test-row">
          <Button
            onClick={this.onTestOmnispindle}
            disabled={testing || !apiKey.trim()}
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          {this.renderOmnispindleTestStatus()}
        </div>
      </div>
    )
  }

  // ─── Local AI ──────────────────────────────────────────────────────────────

  private onLocalAIEnabledChanged = (e: React.FormEvent<HTMLInputElement>) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      enabled: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onAllowNonLocalHttpChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      allowNonLocalHttp: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onSanitizeGitContextChanged = (
    e: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      sanitizeGitContext: (e.currentTarget as HTMLInputElement).checked,
    })
  }

  private onProviderChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = e.currentTarget.value as LocalAIProvider
    const defaults = DefaultLocalAIConfigs[provider]
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      provider,
      baseUrl: defaults.baseUrl ?? this.props.localAIConfig.baseUrl,
      modelId: defaults.modelId ?? this.props.localAIConfig.modelId,
    })
    this.setState({ localAITestStatus: { kind: 'idle' } })
  }

  private onBaseUrlChanged = (value: string) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      baseUrl: value,
    })
    this.setState({ localAITestStatus: { kind: 'idle' } })
  }

  private onModelIdChanged = (value: string) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      modelId: value,
    })
  }

  private onModelSelectChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      modelId: e.currentTarget.value,
    })
  }

  private onPromptModeChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      promptMode: e.currentTarget.value as LocalAIPromptMode,
    })
  }

  private onCustomSystemPromptChanged = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    this.props.onLocalAIConfigChanged({
      ...this.props.localAIConfig,
      customSystemPrompt: e.currentTarget.value,
    })
  }

  private onTestLocalAI = async () => {
    this.setState({ localAITestStatus: { kind: 'testing' } })
    try {
      const models = await testLocalAIConnection(
        this.props.localAIConfig.baseUrl,
        this.props.localAIConfig.allowNonLocalHttp
      )
      if (
        models.length > 0 &&
        !models.includes(this.props.localAIConfig.modelId)
      ) {
        this.props.onLocalAIConfigChanged({
          ...this.props.localAIConfig,
          modelId: models[0],
        })
      }
      this.setState({ localAITestStatus: { kind: 'success', models } })
    } catch (e) {
      this.setState({
        localAITestStatus: {
          kind: 'error',
          message: e instanceof Error ? e.message : 'Connection failed',
        },
      })
    }
  }

  private renderLocalAIModelField() {
    const { localAIConfig } = this.props
    const { localAITestStatus } = this.state
    const disabled = !localAIConfig.enabled

    if (
      localAITestStatus.kind === 'success' &&
      localAITestStatus.models.length > 0
    ) {
      return (
        <div className="local-ai-field-row">
          <label htmlFor="local-ai-model">Model</label>
          <select
            id="local-ai-model"
            value={localAIConfig.modelId}
            onChange={this.onModelSelectChanged}
            disabled={disabled}
          >
            {localAITestStatus.models.map(m => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )
    }

    return (
      <TextBox
        label="Model ID"
        value={localAIConfig.modelId}
        onValueChanged={this.onModelIdChanged}
        placeholder="local-model"
        disabled={disabled}
      />
    )
  }

  private renderLocalAITestStatus() {
    const { localAITestStatus } = this.state
    if (
      localAITestStatus.kind === 'idle' ||
      localAITestStatus.kind === 'testing'
    ) {
      return null
    }
    if (localAITestStatus.kind === 'success') {
      return (
        <span className="local-ai-test-status local-ai-test-ok">
          ✓ {localAITestStatus.models.length} model
          {localAITestStatus.models.length !== 1 ? 's' : ''} available
        </span>
      )
    }
    return (
      <span className="local-ai-test-status local-ai-test-error">
        ✗ {localAITestStatus.message}
      </span>
    )
  }

  private renderLocalAI() {
    const { localAIConfig, showSecuritySettings } = this.props
    const { localAITestStatus } = this.state
    const testing = localAITestStatus.kind === 'testing'
    const disabled = !localAIConfig.enabled

    return (
      <div className="local-ai-preferences-section">
        <h2>Local AI</h2>
        <p className="git-settings-description">
          Generate commit messages using a locally running model via Ollama or
          LM Studio.
        </p>

        <Checkbox
          label="Enable local AI commit message generation"
          value={localAIConfig.enabled ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onLocalAIEnabledChanged}
        />

        <div className="local-ai-field-row">
          <label htmlFor="local-ai-provider">Provider</label>
          <select
            id="local-ai-provider"
            value={localAIConfig.provider}
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
          value={localAIConfig.baseUrl}
          onValueChanged={this.onBaseUrlChanged}
          placeholder="http://localhost:1234"
          disabled={disabled}
        />

        {this.renderLocalAIModelField()}

        <div className="local-ai-test-row">
          <Button
            onClick={this.onTestLocalAI}
            disabled={testing || disabled || !localAIConfig.baseUrl.trim()}
          >
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          {this.renderLocalAITestStatus()}
        </div>

        <div className="local-ai-field-row">
          <label htmlFor="local-ai-prompt-mode">Prompt Mode</label>
          <select
            id="local-ai-prompt-mode"
            value={localAIConfig.promptMode}
            onChange={this.onPromptModeChanged}
            disabled={disabled}
          >
            <option value="default">Default</option>
            <option value="conventional">Conventional Commits</option>
            <option value="custom">Custom</option>
          </select>
        </div>

        {localAIConfig.promptMode === 'custom' && (
          <div className="local-ai-field-row">
            <label htmlFor="local-ai-custom-prompt">Custom System Prompt</label>
            <textarea
              id="local-ai-custom-prompt"
              className="local-ai-custom-prompt"
              value={localAIConfig.customSystemPrompt}
              onChange={this.onCustomSystemPromptChanged}
              placeholder="Enter your system prompt..."
              rows={6}
              disabled={disabled}
            />
          </div>
        )}

        {showSecuritySettings && (
          <>
            <Checkbox
              label="Allow non-local HTTP endpoints"
              value={
                localAIConfig.allowNonLocalHttp
                  ? CheckboxValue.On
                  : CheckboxValue.Off
              }
              onChange={this.onAllowNonLocalHttpChanged}
              disabled={disabled}
            />
            <Checkbox
              label="Sanitize git context in prompts"
              value={
                localAIConfig.sanitizeGitContext
                  ? CheckboxValue.On
                  : CheckboxValue.Off
              }
              onChange={this.onSanitizeGitContextChanged}
              disabled={disabled}
            />
          </>
        )}
      </div>
    )
  }

  // ─── Main render ───────────────────────────────────────────────────────────

  public render() {
    return (
      <DialogContent>
        {this.renderOmnispindle()}
        {this.renderLocalAI()}
      </DialogContent>
    )
  }
}
