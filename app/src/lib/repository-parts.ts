/**
 * The "exploded view" parts model: a repository's committed tree broken into
 * the folders, submodules and loose files it's assembled from, each folder
 * carrying the rolled-up file count and byte size of everything beneath it.
 *
 * Pure — the git call that feeds it lives in `git/repository-parts.ts`.
 */

export type RepositoryPartKind = 'folder' | 'submodule' | 'file'

export interface IRepositoryPart {
  readonly kind: RepositoryPartKind
  /** The last path segment, or '' for the repository root. */
  readonly name: string
  /** Path relative to the repository root with '/' separators, '' for root. */
  readonly path: string
  /**
   * Files at or beneath this part. A submodule counts as zero — its contents
   * belong to another repository, not this one.
   */
  readonly fileCount: number
  /** Committed blob bytes at or beneath this part. Zero for a submodule. */
  readonly byteSize: number
  /** Folders, then submodules, then files — each group alphabetical. */
  readonly children: ReadonlyArray<IRepositoryPart>
}

/** One record of `git ls-tree -r -l -z`. */
export interface ILsTreeEntry {
  readonly mode: string
  readonly path: string
  /** Blob size in bytes; null for a submodule (gitlink) entry. */
  readonly size: number | null
}

/** The mode git gives a gitlink — a submodule's pinned commit. */
const GitlinkMode = '160000'

const lsTreeRecordRe = /^(\d+) \w+ [0-9a-f]+ +(-|\d+)\t([\s\S]+)$/

/** Parse NUL-separated `git ls-tree -r -l -z` output. */
export function parseLsTree(stdout: string): ReadonlyArray<ILsTreeEntry> {
  const entries = new Array<ILsTreeEntry>()
  for (const record of stdout.split('\0')) {
    const match = lsTreeRecordRe.exec(record)
    if (match === null) {
      continue
    }
    const [, mode, size, path] = match
    entries.push({ mode, path, size: size === '-' ? null : parseInt(size, 10) })
  }
  return entries
}

interface IMutablePart {
  kind: RepositoryPartKind
  name: string
  path: string
  fileCount: number
  byteSize: number
  children: Map<string, IMutablePart>
}

const kindOrder: Record<RepositoryPartKind, number> = {
  folder: 0,
  submodule: 1,
  file: 2,
}

function freeze(part: IMutablePart): IRepositoryPart {
  const children = [...part.children.values()]
    .sort(
      (a, b) =>
        kindOrder[a.kind] - kindOrder[b.kind] || a.name.localeCompare(b.name)
    )
    .map(freeze)
  return { ...part, children }
}

/** Assemble flat tree entries into the nested parts model. */
export function buildPartsTree(
  entries: ReadonlyArray<ILsTreeEntry>
): IRepositoryPart {
  const root: IMutablePart = {
    kind: 'folder',
    name: '',
    path: '',
    fileCount: 0,
    byteSize: 0,
    children: new Map(),
  }

  for (const entry of entries) {
    const segments = entry.path.split('/')
    const isSubmodule = entry.mode === GitlinkMode
    const fileCount = isSubmodule ? 0 : 1
    const byteSize = entry.size ?? 0

    let node = root
    node.fileCount += fileCount
    node.byteSize += byteSize

    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]
      let folder = node.children.get(name)
      if (folder === undefined) {
        folder = {
          kind: 'folder',
          name,
          path: segments.slice(0, i + 1).join('/'),
          fileCount: 0,
          byteSize: 0,
          children: new Map(),
        }
        node.children.set(name, folder)
      }
      folder.fileCount += fileCount
      folder.byteSize += byteSize
      node = folder
    }

    const name = segments[segments.length - 1]
    node.children.set(name, {
      kind: isSubmodule ? 'submodule' : 'file',
      name,
      path: entry.path,
      fileCount,
      byteSize,
      children: new Map(),
    })
  }

  return freeze(root)
}

/** Find the part at `path` ('' is the root), or null if it isn't there. */
export function findPart(
  root: IRepositoryPart,
  path: string
): IRepositoryPart | null {
  if (path === '') {
    return root
  }
  let node: IRepositoryPart | undefined = root
  for (const name of path.split('/')) {
    node = node.children.find(c => c.name === name && c.kind !== 'file')
    if (node === undefined) {
      return null
    }
  }
  return node
}

/** Submodules at or beneath `part`. */
export function countSubmodules(part: IRepositoryPart): number {
  if (part.kind === 'submodule') {
    return 1
  }
  return part.children.reduce((sum, c) => sum + countSubmodules(c), 0)
}

/**
 * The instruction-manual callout for the nth part: A…Z, then AA, AB…
 * (bijective base 26, like spreadsheet columns).
 */
export function partLabel(index: number): string {
  let label = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}
