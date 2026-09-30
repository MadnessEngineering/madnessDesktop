import * as React from 'react'
import { join } from 'path'
import classNames from 'classnames'
import memoizeOne from 'memoize-one'

import { Repository } from '../../models/repository'
import { SubmoduleEntry } from '../../models/submodule'
import {
  RecentTouchCommitLimit,
  getRecentTouches,
  getRepositoryParts,
  listSubmodules,
} from '../../lib/git'
import {
  IPaintableFile,
  PaintMode,
  PaintModes,
  driftReasons,
  isPaintMode,
  paintIntensity,
  tallyByPart,
} from '../../lib/exploded-paint'
import { IDrawingPartInput } from '../../lib/exploded-drawing'
import {
  IRepositoryPart,
  countSubmodules,
  findPart,
  partLabel,
} from '../../lib/repository-parts'
import { Dispatcher } from '../dispatcher'
import { Octicon, syncClockwise } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { formatBytes } from '../lib/bytes'
import { formatNumber } from '../../lib/format-number'
import { ExplodedDrawing } from './exploded-drawing'

/** Loose files listed in the hardware box before it folds into "+N more". */
const MaxHardwareShown = 24

/** Sub-part blocks drawn inside a part card's mini blueprint. */
const MaxBlueprintBlocks = 12

/** Remembers the paint mode across repositories and sessions. */
const PaintModeKey = 'exploded-view-paint-mode'

const paintModeLabels: Record<PaintMode, string> = {
  off: 'Off',
  local: 'Local',
  history: 'History',
  drift: 'Drift',
}

const paintLegends: Record<Exclude<PaintMode, 'off'>, string> = {
  local: 'Amber side: uncommitted changes housed in the part.',
  history: `Amber side: work in the last ${RecentTouchCommitLimit} commits — the more sawdust, the brighter.`,
  drift:
    'Amber side: submodules moved off their pinned commit, or carrying work of their own.',
}

function readPaintMode(fallback: PaintMode): PaintMode {
  try {
    const stored = localStorage.getItem(PaintModeKey)
    return isPaintMode(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

function plural(n: number, one: string, many: string) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}

/** What a part's paint count means, in words, for its card. */
function paintNote(
  mode: PaintMode,
  part: IRepositoryPart,
  count: number,
  reasons: ReadonlyMap<string, ReadonlyArray<string>>
): string | null {
  if (count === 0) {
    return null
  }
  switch (mode) {
    case 'local':
      return `${plural(count, 'file', 'files')} changed`
    case 'history':
      return `touched ${formatNumber(count)}× lately`
    case 'drift':
      return part.kind === 'submodule'
        ? (reasons.get(part.path) ?? []).join(', ')
        : `${plural(count, 'submodule', 'submodules')} drifted`
    default:
      return null
  }
}

interface IExplodedViewProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher

  /**
   * The tracked repository this one sits inside, if any — the breadcrumb's
   * way back out after stepping into a submodule.
   */
  readonly parentRepository: Repository | null

  /**
   * The working directory's changed files — what the Local and Drift paint
   * modes mark up. Empty on the no-changes page.
   */
  readonly changedFiles: ReadonlyArray<IPaintableFile>

  /** The paint mode to start in when the user hasn't picked one yet. */
  readonly defaultPaintMode?: PaintMode
}

interface IExplodedViewState {
  readonly loading: boolean
  /** null once loaded means there was no HEAD to take apart. */
  readonly root: IRepositoryPart | null
  readonly error: string | null
  readonly submodules: ReadonlyMap<string, SubmoduleEntry>
  /** The folder being viewed, relative to the root; '' is the whole repo. */
  readonly currentPath: string
  /** A submodule path with an init or switch in flight. */
  readonly busyPath: string | null
  /** The part under the pointer, in the drawing or on its card. */
  readonly hoveredPath: string | null
  readonly paintMode: PaintMode
  /** Commit touches per path for History paint; null until first needed. */
  readonly recentTouches: ReadonlyMap<string, number> | null
}

/**
 * Dot-folders (.cursor, .github, .vscode…) are tool configuration, not parts
 * of the build — they get a compact row of their own instead of lettered
 * parts and blocks in the drawing.
 */
function isShopConfig(part: IRepositoryPart) {
  return part.kind === 'folder' && part.name.startsWith('.')
}

function describePart(part: IRepositoryPart, sub?: SubmoduleEntry) {
  if (part.kind === 'submodule') {
    if (sub === undefined) {
      return 'submodule'
    }
    const status = sub.status === 'initialized' ? '' : ` · ${sub.status}`
    return `submodule @ ${sub.sha.slice(0, 7)}${status}`
  }
  const parts = [
    `${formatNumber(part.fileCount)} ${
      part.fileCount === 1 ? 'file' : 'files'
    }`,
  ]
  const submodules = countSubmodules(part)
  if (submodules > 0) {
    parts.push(`${submodules} ${submodules === 1 ? 'submodule' : 'submodules'}`)
  }
  if (part.fileCount > 0) {
    parts.push(formatBytes(part.byteSize))
  }
  return parts.join(' · ')
}

interface ICrumbProps {
  readonly label: string
  readonly path: string
  readonly current: boolean
  readonly onNavigate: (path: string) => void
}

class Crumb extends React.Component<ICrumbProps> {
  private onClick = () => this.props.onNavigate(this.props.path)

  public render() {
    const { label, current } = this.props
    return (
      <button
        className={classNames('exploded-crumb', { current })}
        onClick={this.onClick}
        disabled={current}
        aria-current={current ? 'location' : undefined}
      >
        {label}
      </button>
    )
  }
}

interface IPartCardProps {
  readonly part: IRepositoryPart
  readonly label: string
  readonly submodule: SubmoduleEntry | undefined
  readonly busy: boolean
  readonly highlighted: boolean
  /** Amber intensity for the card's painted edge, 0–1. */
  readonly paint: number
  readonly paintNote: string | null
  readonly onActivate: (part: IRepositoryPart) => void
  readonly onHover: (path: string | null) => void
}

/** One lettered part of the assembly, with a mini blueprint of its insides. */
class PartCard extends React.Component<IPartCardProps> {
  private onClick = () => this.props.onActivate(this.props.part)
  private onEnter = () => this.props.onHover(this.props.part.path)
  private onLeave = () => this.props.onHover(null)

  private renderBlueprint() {
    const { part } = this.props
    if (part.kind === 'submodule') {
      return null
    }

    const inner = part.children
      .filter(c => c.kind !== 'file')
      .slice(0, MaxBlueprintBlocks)
    if (inner.length === 0) {
      return null
    }

    return (
      <div className="exploded-part-blueprint" aria-hidden={true}>
        {inner.map(c => (
          <div
            key={c.path}
            className={classNames('exploded-part-block', c.kind)}
            style={{
              flexGrow: Math.max(
                part.byteSize > 0 ? c.byteSize / part.byteSize : 0,
                0.04
              ),
            }}
          />
        ))}
      </div>
    )
  }

  private get actionText() {
    const { part, submodule, busy } = this.props
    if (part.kind === 'folder') {
      return 'Step in'
    }
    if (submodule?.status === 'uninitialized') {
      return busy ? 'Fitting…' : 'Init to step in'
    }
    return busy ? 'Switching…' : 'Switch to repo'
  }

  public render() {
    const { part, label, submodule, busy, highlighted, paint, paintNote } =
      this.props
    const uninitialized = submodule?.status === 'uninitialized'
    const style = { '--exploded-paint': paint } as React.CSSProperties

    return (
      <li
        className={classNames('exploded-part', part.kind, {
          uninitialized,
          highlighted,
          painted: paint > 0,
        })}
        style={style}
      >
        <button
          className="exploded-part-button"
          onClick={this.onClick}
          onMouseEnter={this.onEnter}
          onMouseLeave={this.onLeave}
          onFocus={this.onEnter}
          onBlur={this.onLeave}
          disabled={busy}
        >
          <span className="exploded-part-label">{label}</span>
          <span className="exploded-part-heading">
            <Octicon
              symbol={
                part.kind === 'submodule'
                  ? octicons.fileSubmodule
                  : octicons.fileDirectory
              }
            />
            <span className="exploded-part-name">{part.name}</span>
          </span>
          <span className="exploded-part-meta">
            {describePart(part, submodule)}
          </span>
          {paintNote !== null && (
            <span className="exploded-part-paint-note">{paintNote}</span>
          )}
          {this.renderBlueprint()}
          <span className="exploded-part-action">
            {busy && <Octicon symbol={syncClockwise} className="spin" />}
            {this.actionText}
          </span>
        </button>
      </li>
    )
  }
}

interface IShopConfigChipProps {
  readonly part: IRepositoryPart
  readonly onActivate: (part: IRepositoryPart) => void
}

class ShopConfigChip extends React.Component<IShopConfigChipProps> {
  private onClick = () => this.props.onActivate(this.props.part)

  public render() {
    const { part } = this.props
    return (
      <li>
        <button className="exploded-shop-chip" onClick={this.onClick}>
          <Octicon symbol={octicons.fileDirectory} />
          <span className="exploded-shop-chip-name">{part.name}</span>
          <span className="exploded-shop-chip-meta">
            {formatNumber(part.fileCount)}
          </span>
        </button>
      </li>
    )
  }
}

interface IPaintModeButtonProps {
  readonly mode: PaintMode
  readonly selected: boolean
  readonly onSelect: (mode: PaintMode) => void
}

class PaintModeButton extends React.Component<IPaintModeButtonProps> {
  private onClick = () => this.props.onSelect(this.props.mode)

  public render() {
    const { mode, selected } = this.props
    return (
      <button
        className={classNames({ selected })}
        aria-pressed={selected}
        onClick={this.onClick}
      >
        {paintModeLabels[mode]}
      </button>
    )
  }
}

/**
 * An instruction-manual exploded view of the repository: the folders and
 * submodules it's assembled from, lettered as parts, with a materials list.
 *
 * Folders step in place; a submodule steps by switching the whole app to
 * that submodule's repository.
 */
export class ExplodedView extends React.Component<
  IExplodedViewProps,
  IExplodedViewState
> {
  private unmounted = false

  // Each mode's tally rolls every change up through its folders; memoized so
  // hovering (which re-renders constantly) doesn't redo it.
  private localTally = memoizeOne((files: ReadonlyArray<IPaintableFile>) =>
    tallyByPart(files.map(f => [f.path, 1] as const))
  )

  private historyTally = memoizeOne(
    (touches: ReadonlyMap<string, number> | null) =>
      tallyByPart(touches ?? new Map())
  )

  private driftData = memoizeOne(
    (
      submodules: ReadonlyMap<string, SubmoduleEntry>,
      files: ReadonlyArray<IPaintableFile>
    ) => {
      const reasons = driftReasons([...submodules.values()], files)
      const tally = tallyByPart([...reasons.keys()].map(p => [p, 1] as const))
      return { reasons, tally }
    }
  )

  private uninitializedPaths = memoizeOne(
    (submodules: ReadonlyMap<string, SubmoduleEntry>) =>
      new Set(
        [...submodules.values()]
          .filter(sub => sub.status === 'uninitialized')
          .map(sub => sub.path)
      )
  )

  private drawingParts = memoizeOne(
    (
      parts: ReadonlyArray<IRepositoryPart>,
      tally: ReadonlyMap<string, number>
    ): ReadonlyArray<IDrawingPartInput> =>
      parts.map((p, i) => {
        const count = tally.get(p.path) ?? 0
        return {
          path: p.path,
          label: partLabel(i),
          name: p.name,
          kind: p.kind === 'submodule' ? 'submodule' : 'folder',
          byteSize: p.byteSize,
          badge: count > 0 ? formatNumber(count) : undefined,
        }
      })
  )

  public constructor(props: IExplodedViewProps) {
    super(props)
    this.state = {
      loading: true,
      root: null,
      error: null,
      submodules: new Map(),
      currentPath: '',
      busyPath: null,
      hoveredPath: null,
      paintMode: readPaintMode(props.defaultPaintMode ?? 'off'),
      recentTouches: null,
    }
  }

  public componentDidMount() {
    this.load()
    if (this.state.paintMode === 'history') {
      this.loadRecentTouches()
    }
  }

  public componentWillUnmount() {
    this.unmounted = true
  }

  private async loadRecentTouches() {
    try {
      const recentTouches = await getRecentTouches(this.props.repository)
      if (!this.unmounted) {
        this.setState({ recentTouches })
      }
    } catch (e) {
      log.error('Exploded view: could not read recent history', e)
      if (!this.unmounted) {
        this.setState({ recentTouches: new Map() })
      }
    }
  }

  private onSelectPaintMode = (paintMode: PaintMode) => {
    try {
      localStorage.setItem(PaintModeKey, paintMode)
    } catch {
      // Remembering is a nicety; the mode still switches.
    }
    this.setState({ paintMode })
    if (paintMode === 'history' && this.state.recentTouches === null) {
      this.loadRecentTouches()
    }
  }

  private getPaint(): {
    tally: ReadonlyMap<string, number>
    reasons: ReadonlyMap<string, ReadonlyArray<string>>
  } {
    const none = new Map()
    switch (this.state.paintMode) {
      case 'local':
        return {
          tally: this.localTally(this.props.changedFiles),
          reasons: none,
        }
      case 'history':
        return {
          tally: this.historyTally(this.state.recentTouches),
          reasons: none,
        }
      case 'drift':
        return this.driftData(this.state.submodules, this.props.changedFiles)
      default:
        return { tally: none, reasons: none }
    }
  }

  private async load() {
    const { repository } = this.props
    try {
      const [root, submodules] = await Promise.all([
        getRepositoryParts(repository),
        listSubmodules(repository),
      ])
      if (!this.unmounted) {
        this.setState({
          loading: false,
          root,
          error: null,
          submodules: new Map(submodules.map(s => [s.path, s])),
        })
      }
    } catch (e) {
      log.error('Exploded view: could not read the repository parts', e)
      if (!this.unmounted) {
        this.setState({ loading: false, error: String(e) })
      }
    }
  }

  private onNavigate = (path: string) => {
    this.setState({ currentPath: path, hoveredPath: null })
  }

  private onHover = (hoveredPath: string | null) => {
    this.setState({ hoveredPath })
  }

  private onActivatePath = (path: string) => {
    const part = this.state.root && findPart(this.state.root, path)
    if (part) {
      this.onActivatePart(part)
    }
  }

  private onOpenParent = () => {
    const { parentRepository, dispatcher } = this.props
    if (parentRepository !== null) {
      dispatcher.selectRepository(parentRepository)
    }
  }

  private onActivatePart = async (part: IRepositoryPart) => {
    if (part.kind === 'folder') {
      this.setState({ currentPath: part.path, hoveredPath: null })
      return
    }

    if (part.kind !== 'submodule' || this.state.busyPath !== null) {
      return
    }

    const { repository, dispatcher } = this.props
    const sub = this.state.submodules.get(part.path)
    this.setState({ busyPath: part.path })

    if (sub?.status === 'uninitialized') {
      // Nothing on disk to switch to yet — fit the part first.
      await dispatcher.initSubmodule(repository, part.path)
      await this.load()
      if (!this.unmounted) {
        this.setState({ busyPath: null })
      }
      return
    }

    // Switching repositories unmounts this view, so no state to clear after.
    await dispatcher.openSubmoduleRepository(join(repository.path, part.path))
  }

  private renderBreadcrumbs() {
    const { repository, parentRepository } = this.props
    const segments =
      this.state.currentPath === '' ? [] : this.state.currentPath.split('/')

    return (
      <nav className="exploded-breadcrumbs" aria-label="Exploded view path">
        {parentRepository !== null && (
          <>
            <button
              className="exploded-crumb exploded-crumb-parent"
              onClick={this.onOpenParent}
              aria-label={`Back out to ${parentRepository.name}`}
            >
              <Octicon symbol={octicons.arrowUp} />
              {parentRepository.name}
            </button>
            <Octicon
              className="exploded-crumb-sep"
              symbol={octicons.chevronRight}
            />
          </>
        )}
        <Crumb
          label={repository.name}
          path=""
          current={segments.length === 0}
          onNavigate={this.onNavigate}
        />
        {segments.map((name, i) => (
          <React.Fragment key={i}>
            <Octicon
              className="exploded-crumb-sep"
              symbol={octicons.chevronRight}
            />
            <Crumb
              label={name}
              path={segments.slice(0, i + 1).join('/')}
              current={i === segments.length - 1}
              onNavigate={this.onNavigate}
            />
          </React.Fragment>
        ))}
      </nav>
    )
  }

  private renderShopConfig(folders: ReadonlyArray<IRepositoryPart>) {
    if (folders.length === 0) {
      return null
    }

    return (
      <div className="exploded-shop">
        <h3>
          Shop config <span>tool dot-folders, set aside</span>
        </h3>
        <ul>
          {folders.map(f => (
            <ShopConfigChip
              key={f.path}
              part={f}
              onActivate={this.onActivatePart}
            />
          ))}
        </ul>
      </div>
    )
  }

  private renderHardware(
    files: ReadonlyArray<IRepositoryPart>,
    tally: ReadonlyMap<string, number>
  ) {
    if (files.length === 0) {
      return null
    }

    const shown = files.slice(0, MaxHardwareShown)
    const hidden = files.length - shown.length

    return (
      <div className="exploded-hardware">
        <h3>
          Hardware <span>loose files at this level</span>
        </h3>
        <ul>
          {shown.map(f => (
            <li
              key={f.path}
              title={f.path}
              className={classNames({ painted: tally.has(f.path) })}
            >
              <Octicon symbol={octicons.file} />
              <span className="exploded-hardware-name">{f.name}</span>
              <span className="exploded-hardware-size">
                {formatBytes(f.byteSize)}
              </span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="exploded-hardware-more">
              +{formatNumber(hidden)} more
            </li>
          )}
        </ul>
      </div>
    )
  }

  private renderMaterials(
    parts: ReadonlyArray<IRepositoryPart>,
    shopConfig: ReadonlyArray<IRepositoryPart>,
    files: ReadonlyArray<IRepositoryPart>
  ) {
    if (parts.length === 0 && shopConfig.length === 0 && files.length === 0) {
      return null
    }

    const shopFiles = shopConfig.reduce((sum, f) => sum + f.fileCount, 0)
    const shopBytes = shopConfig.reduce((sum, f) => sum + f.byteSize, 0)

    const looseBytes = files.reduce((sum, f) => sum + f.byteSize, 0)

    return (
      <table className="exploded-materials">
        <caption>Materials</caption>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Part</th>
            <th scope="col">Kind</th>
            <th scope="col" className="num">
              Files
            </th>
            <th scope="col" className="num">
              Size
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part, i) => {
            const sub = this.state.submodules.get(part.path)
            return (
              <tr key={part.path}>
                <td className="exploded-materials-label">{partLabel(i)}</td>
                <td>{part.name}</td>
                <td>
                  {part.kind === 'submodule'
                    ? sub
                      ? `submodule @ ${sub.sha.slice(0, 7)}`
                      : 'submodule'
                    : 'folder'}
                </td>
                <td className="num">
                  {part.kind === 'submodule'
                    ? '—'
                    : formatNumber(part.fileCount)}
                </td>
                <td className="num">
                  {part.kind === 'submodule' ? '—' : formatBytes(part.byteSize)}
                </td>
              </tr>
            )
          })}
          {shopConfig.length > 0 && (
            <tr className="exploded-materials-hardware">
              <td />
              <td>Shop config</td>
              <td>
                {shopConfig.length} dot-
                {shopConfig.length === 1 ? 'folder' : 'folders'}
              </td>
              <td className="num">{formatNumber(shopFiles)}</td>
              <td className="num">{formatBytes(shopBytes)}</td>
            </tr>
          )}
          {files.length > 0 && (
            <tr className="exploded-materials-hardware">
              <td />
              <td>Hardware</td>
              <td>loose files</td>
              <td className="num">{formatNumber(files.length)}</td>
              <td className="num">{formatBytes(looseBytes)}</td>
            </tr>
          )}
        </tbody>
      </table>
    )
  }

  private renderPaintSwitch(tally: ReadonlyMap<string, number>) {
    const { paintMode, recentTouches } = this.state
    const loadingHistory = paintMode === 'history' && recentTouches === null

    return (
      <div className="exploded-paint">
        <div
          className="no-changes-view-toggle exploded-paint-switch"
          role="group"
          aria-label="Paint"
        >
          <span className="exploded-paint-label">Paint</span>
          {PaintModes.map(mode => (
            <PaintModeButton
              key={mode}
              mode={mode}
              selected={mode === paintMode}
              onSelect={this.onSelectPaintMode}
            />
          ))}
        </div>
        {paintMode !== 'off' && (
          <span className="exploded-paint-legend">
            <span className="exploded-paint-swatch" aria-hidden={true} />
            {loadingHistory
              ? 'Reading recent history…'
              : tally.size === 0
              ? `${paintLegends[paintMode]} Nothing to paint right now.`
              : paintLegends[paintMode]}
          </span>
        )}
      </div>
    )
  }

  private renderBody() {
    const {
      loading,
      root,
      error,
      currentPath,
      submodules,
      busyPath,
      hoveredPath,
    } = this.state

    if (loading) {
      return (
        <div className="exploded-message">
          <Octicon symbol={syncClockwise} className="spin" />
          Laying out the parts…
        </div>
      )
    }

    if (error !== null) {
      return (
        <div className="exploded-message">
          Couldn't read this repository's parts: {error}
        </div>
      )
    }

    if (root === null) {
      return (
        <div className="exploded-message">
          Nothing committed yet — no parts to lay out.
        </div>
      )
    }

    const { tally, reasons } = this.getPaint()
    const node = findPart(root, currentPath) ?? root
    const nonFiles = node.children.filter(c => c.kind !== 'file')
    const parts = nonFiles.filter(c => !isShopConfig(c))
    const shopConfig = nonFiles.filter(isShopConfig)
    const files = node.children.filter(c => c.kind === 'file')

    // Intensity is relative to the busiest part in view, so every level you
    // step into uses the full range.
    const maxPaint = Math.max(0, ...parts.map(p => tally.get(p.path) ?? 0))
    const intensity = (path: string) =>
      paintIntensity(tally.get(path) ?? 0, maxPaint)
    const paintByPath = new Map(parts.map(p => [p.path, intensity(p.path)]))

    const submoduleCount = parts.filter(p => p.kind === 'submodule').length
    const summary = [
      `${parts.length} ${parts.length === 1 ? 'part' : 'parts'}`,
      submoduleCount > 0
        ? `${submoduleCount} ${
            submoduleCount === 1 ? 'submodule' : 'submodules'
          }`
        : null,
      `${formatNumber(node.fileCount)} ${
        node.fileCount === 1 ? 'file' : 'files'
      }`,
      formatBytes(node.byteSize),
    ]
      .filter(s => s !== null)
      .join(' · ')

    return (
      <>
        <div className="exploded-sheet">
          <div className="exploded-title">
            <h2>Exploded view</h2>
            <span>{summary}</span>
          </div>
          {this.renderPaintSwitch(tally)}
          <ExplodedDrawing
            parts={this.drawingParts(parts, tally)}
            highlightedPath={hoveredPath}
            uninitializedPaths={this.uninitializedPaths(submodules)}
            paint={paintByPath}
            onHover={this.onHover}
            onActivate={this.onActivatePath}
          />
          {parts.length > 0 && (
            <ol className="exploded-assembly">
              {parts.map((part, i) => (
                <PartCard
                  key={part.path}
                  part={part}
                  label={partLabel(i)}
                  submodule={submodules.get(part.path)}
                  busy={busyPath === part.path}
                  highlighted={hoveredPath === part.path}
                  paint={paintByPath.get(part.path) ?? 0}
                  paintNote={paintNote(
                    this.state.paintMode,
                    part,
                    tally.get(part.path) ?? 0,
                    reasons
                  )}
                  onActivate={this.onActivatePart}
                  onHover={this.onHover}
                />
              ))}
            </ol>
          )}
          {this.renderShopConfig(shopConfig)}
          {this.renderHardware(files, tally)}
        </div>
        {this.renderMaterials(parts, shopConfig, files)}
      </>
    )
  }

  public render() {
    return (
      <div className="exploded-view">
        {this.renderBreadcrumbs()}
        {this.renderBody()}
      </div>
    )
  }
}
