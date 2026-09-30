import * as React from 'react'
import classNames from 'classnames'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import {
  HookLoadout,
  HookScript,
  InstalledScriptStatus,
  LoadoutInstallation,
} from '../../lib/hooks/loadout-types'
import {
  BUILTIN_SCRIPTS,
  getBuiltinScript,
} from '../../lib/hooks/loadout-scripts'
import { BUILTIN_LOADOUTS } from '../../lib/hooks/loadout-presets'
import {
  getInstallation,
  saveInstallation,
  removeInstallation,
  toggleScript as toggleScriptInStore,
  getCustomLoadouts,
  saveCustomLoadout,
  deleteCustomLoadout,
  recordInstalledHashes,
} from '../../lib/hooks/loadout-store'
import {
  installLoadout,
  uninstallLoadout,
  toggleScriptOnDisk,
  detectInstalledScripts,
  classifyScript,
  hashScript,
  readInstalledScript,
  writeInstalledScript,
} from '../../lib/hooks/loadout-manager'

interface IInstalledScriptInfo {
  readonly status: InstalledScriptStatus
  /** The script as it is on disk. */
  readonly text: string
}

const statusLabels: Record<InstalledScriptStatus, string> = {
  current: 'Up to date',
  outdated: 'Update available',
  customized: 'Customized',
}

function scriptsOf(loadout: HookLoadout): ReadonlyArray<HookScript> {
  return loadout.scriptIds
    .map(id => getBuiltinScript(id))
    .filter((s): s is HookScript => s !== undefined)
}

interface IScriptRowProps {
  readonly script: HookScript
  readonly enabled: boolean
  readonly info: IInstalledScriptInfo | undefined
  readonly expanded: boolean
  readonly draft: string
  readonly confirmingReset: boolean
  readonly busy: boolean
  readonly onToggle: (script: HookScript, enabled: boolean) => void
  readonly onToggleExpand: (scriptId: string) => void
  readonly onDraftChange: (text: string) => void
  readonly onSave: (script: HookScript) => void
  readonly onRequestReset: (scriptId: string) => void
  readonly onCancelReset: () => void
  readonly onConfirmReset: (script: HookScript) => void
}

/** One installed script: toggle, status, and an editor when expanded. */
class ScriptRow extends React.Component<IScriptRowProps> {
  private onToggle = (event: React.FormEvent<HTMLInputElement>) =>
    this.props.onToggle(this.props.script, event.currentTarget.checked)
  private onToggleExpand = () => this.props.onToggleExpand(this.props.script.id)
  private onDraftChange = (event: React.ChangeEvent<HTMLTextAreaElement>) =>
    this.props.onDraftChange(event.currentTarget.value)
  private onSave = () => this.props.onSave(this.props.script)
  private onRequestReset = () => this.props.onRequestReset(this.props.script.id)
  private onConfirmReset = () => this.props.onConfirmReset(this.props.script)

  private renderEditor() {
    const { info, draft, confirmingReset, busy, onCancelReset } = this.props
    if (info === undefined) {
      return null
    }
    const dirty = draft !== info.text

    return (
      <div className="loadout-script-editor">
        <textarea
          className="loadout-script-textarea"
          value={draft}
          onChange={this.onDraftChange}
          spellCheck={false}
          aria-label={`${this.props.script.name} script`}
        />
        <div className="loadout-script-editor-actions">
          <button
            type="button"
            className="loadout-btn loadout-btn-install"
            onClick={this.onSave}
            disabled={busy || !dirty}
          >
            Save
          </button>
          {info.status !== 'current' && !confirmingReset && (
            <button
              type="button"
              className="loadout-btn"
              onClick={this.onRequestReset}
              disabled={busy}
            >
              Reset to built-in
            </button>
          )}
          {confirmingReset && (
            <span className="loadout-confirm">
              {info.status === 'customized'
                ? 'Replace your version with the built-in script?'
                : 'Replace this script with the built-in version?'}
              <button
                type="button"
                className="loadout-btn loadout-btn-uninstall"
                onClick={this.onConfirmReset}
                disabled={busy}
              >
                Replace
              </button>
              <button
                type="button"
                className="loadout-btn"
                onClick={onCancelReset}
              >
                Cancel
              </button>
            </span>
          )}
          {dirty && <span className="loadout-unsaved">Unsaved changes</span>}
        </div>
      </div>
    )
  }

  public render() {
    const { script, enabled, info, expanded } = this.props
    return (
      <div className="loadout-script-row">
        <div className="loadout-script-line">
          <Checkbox
            label={script.name}
            value={enabled ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onToggle}
          />
          {info && (
            <span className={classNames('loadout-script-status', info.status)}>
              {statusLabels[info.status]}
            </span>
          )}
          {info && (
            <button
              type="button"
              className="loadout-link-button"
              onClick={this.onToggleExpand}
              aria-expanded={expanded}
            >
              {expanded ? 'Hide' : 'View / edit'}
            </button>
          )}
        </div>
        <span className="loadout-script-desc">{script.description}</span>
        {expanded && this.renderEditor()}
      </div>
    )
  }
}

interface ILoadoutCardProps {
  readonly loadout: HookLoadout
  readonly isInstalled: boolean
  readonly hasOtherInstalled: boolean
  readonly installing: boolean
  readonly confirmingDelete: boolean
  readonly onInstall: (loadout: HookLoadout) => void
  readonly onUninstall: () => void
  readonly onRequestDelete: (loadoutId: string) => void
  readonly onCancelDelete: () => void
  readonly onConfirmDelete: (loadoutId: string) => void
}

class LoadoutCard extends React.Component<ILoadoutCardProps> {
  private onInstall = () => this.props.onInstall(this.props.loadout)
  private onRequestDelete = () =>
    this.props.onRequestDelete(this.props.loadout.id)
  private onConfirmDelete = () =>
    this.props.onConfirmDelete(this.props.loadout.id)

  private renderDelete() {
    const { loadout, isInstalled, confirmingDelete, onCancelDelete } =
      this.props
    if (loadout.builtin || isInstalled) {
      return null
    }
    if (!confirmingDelete) {
      return (
        <button
          type="button"
          className="loadout-btn"
          onClick={this.onRequestDelete}
        >
          Delete
        </button>
      )
    }
    return (
      <span className="loadout-confirm">
        Delete this custom loadout?
        <button
          type="button"
          className="loadout-btn loadout-btn-uninstall"
          onClick={this.onConfirmDelete}
        >
          Delete
        </button>
        <button type="button" className="loadout-btn" onClick={onCancelDelete}>
          Cancel
        </button>
      </span>
    )
  }

  public render() {
    const { loadout, isInstalled, hasOtherInstalled, installing, children } =
      this.props

    return (
      <div
        className={classNames('loadout-card', {
          installed: isInstalled,
          disabled: hasOtherInstalled,
        })}
      >
        <div className="loadout-card-header">
          <span className="loadout-card-title">{loadout.name}</span>
          <span
            className={`loadout-badge ${
              isInstalled ? 'badge-installed' : 'badge-available'
            }`}
          >
            {isInstalled ? 'Installed' : 'Available'}
          </span>
          <span
            className={`loadout-badge ${
              loadout.builtin ? 'badge-builtin' : 'badge-custom'
            }`}
          >
            {loadout.builtin ? 'Builtin' : 'Custom'}
          </span>
        </div>

        <div className="loadout-card-body">
          <p className="loadout-card-description">{loadout.description}</p>
          {!isInstalled && (
            <div className="loadout-script-summary">
              {scriptsOf(loadout).map(s => (
                <span key={s.id} className="loadout-script-chip">
                  {s.name}
                </span>
              ))}
            </div>
          )}
        </div>

        {children}

        <div className="loadout-card-actions">
          {isInstalled ? (
            <button
              className="loadout-btn loadout-btn-uninstall"
              onClick={this.props.onUninstall}
              disabled={installing}
              type="button"
            >
              Uninstall
            </button>
          ) : (
            <button
              className="loadout-btn loadout-btn-install"
              onClick={this.onInstall}
              disabled={installing || hasOtherInstalled}
              type="button"
            >
              Install
            </button>
          )}
          {this.renderDelete()}
        </div>
      </div>
    )
  }
}

interface IHookLoadoutsProps {
  readonly repoPath: string
}

interface IHookLoadoutsState {
  readonly loadouts: ReadonlyArray<HookLoadout>
  readonly installation: LoadoutInstallation | null
  readonly installedScripts: ReadonlyArray<{
    scriptId: string
    enabled: boolean
  }>
  /** Status and on-disk text of each installed script, by id. */
  readonly scriptInfo: ReadonlyMap<string, IInstalledScriptInfo>
  readonly installing: boolean
  readonly error: string | null
  readonly expandedScriptId: string | null
  /** The editor's text for the expanded script. */
  readonly draft: string
  readonly confirmResetId: string | null
  readonly confirmDeleteId: string | null
  readonly customName: string
}

export class HookLoadoutsSettings extends React.Component<
  IHookLoadoutsProps,
  IHookLoadoutsState
> {
  public constructor(props: IHookLoadoutsProps) {
    super(props)
    this.state = {
      loadouts: [],
      installation: null,
      installedScripts: [],
      scriptInfo: new Map(),
      installing: false,
      error: null,
      expandedScriptId: null,
      draft: '',
      confirmResetId: null,
      confirmDeleteId: null,
      customName: '',
    }
  }

  public componentDidMount() {
    this.refresh()
  }

  /** Re-read loadouts, the installation, and every installed script. */
  private async refresh() {
    const { repoPath } = this.props
    const loadouts = [...BUILTIN_LOADOUTS, ...getCustomLoadouts()]
    const installation = getInstallation(repoPath)
    const installedScripts = await detectInstalledScripts(repoPath)

    const scriptInfo = new Map<string, IInstalledScriptInfo>()
    const installed = loadouts.find(l => l.id === installation?.loadoutId)
    if (installation && installed) {
      for (const script of scriptsOf(installed)) {
        const text = await readInstalledScript(repoPath, script)
        if (text !== null) {
          scriptInfo.set(script.id, {
            text,
            status: classifyScript(
              hashScript(text),
              installation.installedHashes?.[script.id],
              hashScript(script.script)
            ),
          })
        }
      }
    }

    this.setState({ loadouts, installation, installedScripts, scriptInfo })
  }

  /** Run an action, showing Working… and any failure. */
  private async run(what: string, action: () => Promise<void>) {
    this.setState({ installing: true, error: null })
    try {
      await action()
    } catch (e) {
      this.setState({ error: `${what} failed: ${e}` })
    }
    await this.refresh()
    this.setState({ installing: false })
  }

  private onInstall = (loadout: HookLoadout) =>
    this.run('Install', async () => {
      const hashes = await installLoadout(
        this.props.repoPath,
        loadout,
        BUILTIN_SCRIPTS
      )
      saveInstallation({
        repoPath: this.props.repoPath,
        loadoutId: loadout.id,
        installedAt: new Date().toISOString(),
        disabledScripts: [],
        installedHashes: hashes,
      })
    })

  private onUninstall = () =>
    this.run('Uninstall', async () => {
      await uninstallLoadout(this.props.repoPath)
      removeInstallation(this.props.repoPath)
      this.setState({ expandedScriptId: null })
    })

  private onToggleScript = (script: HookScript, enabled: boolean) =>
    this.run('Toggle', async () => {
      await toggleScriptOnDisk(this.props.repoPath, script, enabled)
      toggleScriptInStore(this.props.repoPath, script.id, enabled)
    })

  /** Bring every outdated (unedited) script up to the built-in version. */
  private onUpdateOutdated = () =>
    this.run('Update', async () => {
      const hashes: Record<string, string> = {}
      for (const [id, info] of this.state.scriptInfo) {
        const script = getBuiltinScript(id)
        if (info.status === 'outdated' && script) {
          hashes[id] = await writeInstalledScript(
            this.props.repoPath,
            script,
            script.script
          )
        }
      }
      recordInstalledHashes(this.props.repoPath, hashes)
      this.setState({ expandedScriptId: null })
    })

  private onToggleExpand = (scriptId: string) => {
    const expanding = this.state.expandedScriptId !== scriptId
    this.setState({
      expandedScriptId: expanding ? scriptId : null,
      draft: expanding ? this.state.scriptInfo.get(scriptId)?.text ?? '' : '',
      confirmResetId: null,
    })
  }

  private onDraftChange = (draft: string) => this.setState({ draft })

  /** Save an edit. The install record is left alone, so it reads as customized. */
  private onSaveScript = (script: HookScript) =>
    this.run('Save', async () => {
      await writeInstalledScript(this.props.repoPath, script, this.state.draft)
    })

  private onRequestReset = (scriptId: string) =>
    this.setState({ confirmResetId: scriptId })

  private onCancelReset = () => this.setState({ confirmResetId: null })

  private onConfirmReset = (script: HookScript) =>
    this.run('Reset', async () => {
      const hash = await writeInstalledScript(
        this.props.repoPath,
        script,
        script.script
      )
      recordInstalledHashes(this.props.repoPath, { [script.id]: hash })
      this.setState({ confirmResetId: null, draft: script.script })
    })

  private onCustomNameChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    this.setState({ customName: event.currentTarget.value })

  /** Save the installed loadout's enabled scripts as a new custom loadout. */
  private onSaveCustom = () => {
    const { installation, loadouts, customName } = this.state
    const installed = loadouts.find(l => l.id === installation?.loadoutId)
    const name = customName.trim()
    if (!installed || name.length === 0) {
      return
    }
    const scriptIds = installed.scriptIds.filter(id => this.isScriptEnabled(id))
    saveCustomLoadout({
      id: `custom-${Date.now()}`,
      name,
      description: `Saved from ${installed.name}: ${scriptIds.length} ${
        scriptIds.length === 1 ? 'script' : 'scripts'
      }.`,
      scriptIds,
      builtin: false,
    })
    this.setState({ customName: '' })
    this.refresh()
  }

  private onRequestDelete = (confirmDeleteId: string) =>
    this.setState({ confirmDeleteId })

  private onCancelDelete = () => this.setState({ confirmDeleteId: null })

  private onConfirmDelete = (loadoutId: string) => {
    deleteCustomLoadout(loadoutId)
    this.setState({ confirmDeleteId: null })
    this.refresh()
  }

  private isScriptEnabled(scriptId: string): boolean {
    const found = this.state.installedScripts.find(s => s.scriptId === scriptId)
    return found ? found.enabled : true
  }

  private renderUpdates() {
    const { scriptInfo, installation, installing } = this.state
    const outdated = [...scriptInfo.values()].filter(
      i => i.status === 'outdated'
    ).length
    const customized = [...scriptInfo.values()].filter(
      i => i.status === 'customized'
    ).length
    if (outdated === 0 && customized === 0) {
      return null
    }
    const legacy = installation?.installedHashes === undefined

    return (
      <div className="loadout-updates">
        {outdated > 0 && (
          <div className="loadout-updates-line">
            <span>
              {outdated === 1
                ? '1 script has an update.'
                : `${outdated} scripts have updates.`}
              {legacy &&
                ' This loadout was installed before Madness Desktop tracked edits, so updating also replaces any changes you made to those scripts.'}
            </span>
            <button
              type="button"
              className="loadout-btn loadout-btn-install"
              onClick={this.onUpdateOutdated}
              disabled={installing}
            >
              Update scripts
            </button>
          </div>
        )}
        {customized > 0 && (
          <div className="loadout-updates-line">
            {customized === 1
              ? "1 script is customized, so it isn't updated automatically — use Reset to built-in on its row to take the latest version."
              : `${customized} scripts are customized, so they aren't updated automatically — use Reset to built-in on a row to take the latest version.`}
          </div>
        )}
      </div>
    )
  }

  private renderInstalledScripts(loadout: HookLoadout) {
    const scripts = scriptsOf(loadout)
    const byType = new Map<string, HookScript[]>()
    for (const s of scripts) {
      const group = byType.get(s.hookType) ?? []
      group.push(s)
      byType.set(s.hookType, group)
    }
    const { scriptInfo, expandedScriptId, draft, confirmResetId, installing } =
      this.state

    return (
      <div className="loadout-scripts-expanded">
        {this.renderUpdates()}
        {Array.from(byType.entries()).map(([hookType, hookScripts]) => (
          <div key={hookType} className="loadout-hook-group">
            <div className="loadout-hook-type">{hookType}</div>
            {hookScripts.map(s => (
              <ScriptRow
                key={s.id}
                script={s}
                enabled={this.isScriptEnabled(s.id)}
                info={scriptInfo.get(s.id)}
                expanded={expandedScriptId === s.id}
                draft={expandedScriptId === s.id ? draft : ''}
                confirmingReset={confirmResetId === s.id}
                busy={installing}
                onToggle={this.onToggleScript}
                onToggleExpand={this.onToggleExpand}
                onDraftChange={this.onDraftChange}
                onSave={this.onSaveScript}
                onRequestReset={this.onRequestReset}
                onCancelReset={this.onCancelReset}
                onConfirmReset={this.onConfirmReset}
              />
            ))}
          </div>
        ))}
        <div className="loadout-save-custom">
          <input
            type="text"
            className="loadout-custom-name"
            placeholder="Name for a custom loadout"
            aria-label="Custom loadout name"
            value={this.state.customName}
            onChange={this.onCustomNameChange}
          />
          <button
            type="button"
            className="loadout-btn"
            onClick={this.onSaveCustom}
            disabled={this.state.customName.trim().length === 0}
          >
            Save as Custom Loadout
          </button>
          <span className="loadout-save-custom-hint">
            Saves the scripts switched on above.
          </span>
        </div>
      </div>
    )
  }

  public render() {
    const { installation, error, installing, loadouts, confirmDeleteId } =
      this.state

    return (
      <DialogContent>
        <div className="hook-loadouts">
          <p className="loadout-description">
            Hook loadouts install composable git hook scripts into this
            repository. Each hook type gets a dispatcher that runs individual
            scripts from a <code>.d/</code> directory, so scripts can be toggled
            independently.
          </p>

          {error && <div className="loadout-error">{error}</div>}

          {installation && (
            <div className="loadout-status-bar">
              <span className="loadout-status-label">Active:</span>
              <span className="loadout-status-name">
                {loadouts.find(l => l.id === installation.loadoutId)?.name ??
                  installation.loadoutId}
              </span>
              <span className="loadout-status-date">
                {new Date(installation.installedAt).toLocaleDateString()}
              </span>
            </div>
          )}

          {installing && <p className="loadout-working">Working...</p>}

          {/* The installed loadout first: it's the one you can act on. */}
          {[...loadouts]
            .sort(
              (a, b) =>
                Number(b.id === installation?.loadoutId) -
                Number(a.id === installation?.loadoutId)
            )
            .map(loadout => {
              const isInstalled = installation?.loadoutId === loadout.id
              return (
                <LoadoutCard
                  key={loadout.id}
                  loadout={loadout}
                  isInstalled={isInstalled}
                  hasOtherInstalled={installation !== null && !isInstalled}
                  installing={installing}
                  confirmingDelete={confirmDeleteId === loadout.id}
                  onInstall={this.onInstall}
                  onUninstall={this.onUninstall}
                  onRequestDelete={this.onRequestDelete}
                  onCancelDelete={this.onCancelDelete}
                  onConfirmDelete={this.onConfirmDelete}
                >
                  {isInstalled && this.renderInstalledScripts(loadout)}
                </LoadoutCard>
              )
            })}
        </div>
      </DialogContent>
    )
  }
}
