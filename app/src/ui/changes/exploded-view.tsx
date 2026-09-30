import * as React from 'react'
import { join } from 'path'
import classNames from 'classnames'

import { Repository } from '../../models/repository'
import { SubmoduleEntry } from '../../models/submodule'
import { getRepositoryParts, listSubmodules } from '../../lib/git'
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

interface IExplodedViewProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher

  /**
   * The tracked repository this one sits inside, if any — the breadcrumb's
   * way back out after stepping into a submodule.
   */
  readonly parentRepository: Repository | null
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
    const { part, label, submodule, busy, highlighted } = this.props
    const uninitialized = submodule?.status === 'uninitialized'

    return (
      <li
        className={classNames('exploded-part', part.kind, {
          uninitialized,
          highlighted,
        })}
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
    }
  }

  public componentDidMount() {
    this.load()
  }

  public componentWillUnmount() {
    this.unmounted = true
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

  private renderHardware(files: ReadonlyArray<IRepositoryPart>) {
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
            <li key={f.path} title={f.path}>
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

    const node = findPart(root, currentPath) ?? root
    const nonFiles = node.children.filter(c => c.kind !== 'file')
    const parts = nonFiles.filter(c => !isShopConfig(c))
    const shopConfig = nonFiles.filter(isShopConfig)
    const files = node.children.filter(c => c.kind === 'file')

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
          <ExplodedDrawing
            parts={parts.map((p, i) => ({
              path: p.path,
              label: partLabel(i),
              name: p.name,
              kind: p.kind === 'submodule' ? 'submodule' : 'folder',
              byteSize: p.byteSize,
            }))}
            highlightedPath={hoveredPath}
            uninitializedPaths={
              new Set(
                [...submodules.values()]
                  .filter(sub => sub.status === 'uninitialized')
                  .map(sub => sub.path)
              )
            }
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
                  onActivate={this.onActivatePart}
                  onHover={this.onHover}
                />
              ))}
            </ol>
          )}
          {this.renderShopConfig(shopConfig)}
          {this.renderHardware(files)}
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
