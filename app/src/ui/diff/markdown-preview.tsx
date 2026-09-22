import * as React from 'react'
import * as Path from 'path'
import { readFile } from 'fs/promises'
import { pathToFileURL } from 'url'

import { Repository } from '../../models/repository'
import {
  AppFileStatusKind,
  CommittedFileChange,
  WorkingDirectoryFileChange,
} from '../../models/status'
import { getPartialBlobContents } from '../../lib/git/show'
import { getOldPathOrDefault } from '../../lib/get-old-path'
import { resolveWithin } from '../../lib/path'
import { Emoji } from '../../lib/emoji'
import { SandboxedMarkdown } from '../lib/sandboxed-markdown'
import { Loading } from '../lib/loading'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

type ChangedFile = WorkingDirectoryFileChange | CommittedFileChange

/**
 * Whether the user last chose the rendered file over its diff. Remembered so
 * that browsing a folder of markdown doesn't mean toggling on every file.
 */
export const markdownPreviewKey = 'markdown-preview-enabled'

/** The most of a file we'll read to render a preview of it. */
const MaxPreviewContentLength = 1024 * 1024

/** The most of an image we'll inline into the preview. */
const MaxInlineImageLength = 2 * 1024 * 1024

const ImageMimeTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
])

/**
 * Markdown image references, both `![alt](path)` and `<img src="path">`, with
 * the path itself captured.
 */
const ImageReference =
  /(!\[[^\]]*\]\(\s*)([^)\s]+)|(<img\b[^>]*?\bsrc=["'])([^"']+)/gi

const MarkdownExtensions = new Set([
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.mkdn',
  '.mdx',
])

/** Whether the file at the given path is one we can render a preview of. */
export function isMarkdownFile(path: string) {
  return MarkdownExtensions.has(Path.extname(path).toLowerCase())
}

/**
 * Where to read a file's contents from in order to preview it.
 *
 * A file in a commit is read out of that commit, and one that the commit
 * deleted is read out of its parent so that there's something to show. A file
 * in the working directory is read off disk unless it's been deleted, in which
 * case the copy in HEAD is the last one there was.
 */
export function getPreviewSource(
  file: ChangedFile
):
  | { kind: 'working-tree'; path: string }
  | { kind: 'blob'; commitish: string; path: string } {
  const deleted = file.status.kind === AppFileStatusKind.Deleted

  if (file instanceof CommittedFileChange) {
    return deleted
      ? {
          kind: 'blob',
          commitish: file.parentCommitish,
          path: getOldPathOrDefault(file),
        }
      : { kind: 'blob', commitish: file.commitish, path: file.path }
  }

  return deleted
    ? { kind: 'blob', commitish: 'HEAD', path: getOldPathOrDefault(file) }
    : { kind: 'working-tree', path: file.path }
}

/** Whether a reference points at something we'd have to go out and fetch. */
function isExternalReference(reference: string) {
  return /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)
}

/**
 * Typography for the preview, injected into the sandboxed iframe on top of the
 * markdown stylesheet the app shares with pull request bodies.
 *
 * That stylesheet is written for a comment box -- narrow, short, and never a
 * whole document. A file rendered across a maximized window is a different
 * problem: the measure has to be capped or the eye loses the line it is on,
 * and the parts of GitHub's markdown that only show up in files (task lists,
 * footnotes) have no rules there at all.
 */
const PreviewStyles = `
  /* ~90 characters at the base font size. Left-aligned rather than centred:
     the preview sits beside the file list, and centring floats it away from
     the file it belongs to. */
  #content {
    max-width: 90ch;
    padding: 0 var(--spacing, 10px);
  }

  /* The file's own title shouldn't start a line down from the top of a pane
     that is already titled. */
  .markdown-body > :first-child {
    margin-top: 0;
  }

  /* A task list is a list of states, not of bullets -- GitHub drops the
     marker and hangs the checkbox in the margin. markdown.css has no rules
     for any of this, so a checked box renders with a bullet beside it.
     Selected with :has rather than .task-list-item because marked emits the
     checkbox with no class of its own (GitHub's own markup has one, its
     parser is not this one). */
  .markdown-body li:has(> input[type='checkbox']) {
    list-style-type: none;
  }

  .markdown-body li:has(> input[type='checkbox']) + li {
    margin-top: 4px;
  }

  .markdown-body li > input[type='checkbox'] {
    margin: 0 0.35em 0.25em -1.4em;
    vertical-align: middle;
  }

  /* Long lines in a code block scroll on their own rather than stretching the
     document out under them. */
  .markdown-body pre {
    overflow-x: auto;
  }

  /* Wide tables do the same, and keep their own border while doing it. */
  .markdown-body table {
    display: block;
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
  }

  /* An image is usually a screenshot: let it sit on its own line rather than
     wrapping text around whatever height it happens to be. */
  .markdown-body img {
    display: block;
  }

  .markdown-body .footnotes {
    font-size: var(--font-size-sm);
    color: var(--md-fg-muted-color);
  }
`

interface IMarkdownPreviewProps {
  readonly repository: Repository

  /** The file to render. */
  readonly file: ChangedFile

  /** Map from the emoji shortcut (e.g., :+1:) to the image's local path. */
  readonly emoji: Map<string, Emoji>

  /** Called with the url of an https link clicked in the preview. */
  readonly onMarkdownLinkClicked?: (url: string) => void
}

interface IMarkdownPreviewState {
  readonly contents: string | null
  readonly error: string | null
  readonly truncated: boolean
}

/**
 * The rendered contents of a markdown file, shown in place of its diff.
 *
 * The diff itself only carries the lines that changed, so the contents are
 * read again here - out of the commit when looking at history, off disk when
 * looking at the working directory.
 */
export class MarkdownPreview extends React.Component<
  IMarkdownPreviewProps,
  IMarkdownPreviewState
> {
  public constructor(props: IMarkdownPreviewProps) {
    super(props)

    this.state = { contents: null, error: null, truncated: false }
  }

  public componentDidMount() {
    this.loadContents()
  }

  public componentDidUpdate(prevProps: IMarkdownPreviewProps) {
    if (
      prevProps.file.id !== this.props.file.id ||
      prevProps.repository.path !== this.props.repository.path
    ) {
      this.setState({ contents: null, error: null, truncated: false })
      this.loadContents()
    }
  }

  private async loadContents() {
    const { repository, file } = this.props
    const fileID = file.id

    try {
      const contents = await this.readContents()

      // The user moved on to another file while we were reading this one.
      if (this.props.file.id !== fileID) {
        return
      }

      const truncated = contents.length > MaxPreviewContentLength
      const withImages = await this.inlineLocalImages(
        contents.slice(0, MaxPreviewContentLength)
      )

      // The user moved on while we were reading the images.
      if (this.props.file.id !== fileID) {
        return
      }

      this.setState({ contents: withImages, truncated, error: null })
    } catch (e) {
      if (this.props.file.id !== fileID) {
        return
      }

      log.error(
        `Failed to read ${file.path} in ${repository.path} for preview`,
        e
      )

      this.setState({
        contents: null,
        truncated: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  }

  private async readContents(): Promise<string> {
    const { repository, file } = this.props
    const source = getPreviewSource(file)

    if (source.kind === 'blob') {
      const contents = await getPartialBlobContents(
        repository,
        source.commitish,
        source.path,
        MaxPreviewContentLength
      )

      if (contents === null) {
        throw new Error(`${source.path} isn't in ${source.commitish}.`)
      }

      return contents.toString('utf8')
    }

    const fullPath = await resolveWithin(repository.path, source.path)

    if (fullPath === null) {
      throw new Error(`${source.path} is outside of the repository.`)
    }

    return readFile(fullPath, 'utf8')
  }

  /**
   * Swap the images the file refers to for the images themselves.
   *
   * The preview renders inside a sandboxed iframe served from a data url, and
   * a document like that isn't allowed to go and load anything off disk. So
   * anything local gets read here and inlined; anything remote is left for the
   * iframe to fetch (or not) as it sees fit.
   */
  private async inlineLocalImages(markdown: string): Promise<string> {
    const references = new Set<string>()

    for (const match of markdown.matchAll(ImageReference)) {
      const reference = match[2] ?? match[4]

      if (reference !== undefined && !isExternalReference(reference)) {
        references.add(reference)
      }
    }

    if (references.size === 0) {
      return markdown
    }

    const inlined = new Map<string, string>()

    await Promise.all(
      Array.from(references, async reference => {
        const dataURI = await this.readImageAsDataURI(reference)

        if (dataURI !== null) {
          inlined.set(reference, dataURI)
        }
      })
    )

    return markdown.replace(
      ImageReference,
      (match, prefix, mdPath, imgPrefix, htmlPath) => {
        const reference = mdPath ?? htmlPath
        const dataURI = inlined.get(reference)

        return dataURI === undefined
          ? match
          : `${prefix ?? imgPrefix}${dataURI}`
      }
    )
  }

  /**
   * Read an image the markdown points at, as a data uri. Paths are relative to
   * the file itself, or to the root of the repository when they start with a
   * slash, and anything that resolves outside the repository is left alone.
   */
  private async readImageAsDataURI(reference: string): Promise<string | null> {
    const { repository, file } = this.props
    const mimeType = ImageMimeTypes.get(Path.extname(reference).toLowerCase())

    if (mimeType === undefined) {
      return null
    }

    try {
      const decoded = decodeURIComponent(reference.split(/[?#]/)[0])
      const relativeTo = decoded.startsWith('/')
        ? decoded.slice(1)
        : Path.join(Path.dirname(file.path), decoded)

      const fullPath = await resolveWithin(repository.path, relativeTo)

      if (fullPath === null) {
        return null
      }

      const contents = await readFile(fullPath)

      if (contents.length > MaxInlineImageLength) {
        return null
      }

      return `data:${mimeType};base64,${contents.toString('base64')}`
    } catch (e) {
      // An image that isn't there renders as a broken image, same as it would
      // anywhere else. Nothing here is worth failing the preview over.
      return null
    }
  }

  /**
   * Relative links and images in the markdown resolve against the folder the
   * file sits in. A historical version still points at the working tree copy
   * of its images, which is the only copy there is to show.
   */
  private get baseHref() {
    const { repository, file } = this.props
    const directory = Path.dirname(Path.join(repository.path, file.path))

    return pathToFileURL(`${directory}${Path.sep}`).toString()
  }

  public render() {
    const { contents, error } = this.state

    if (error !== null) {
      return (
        <div className="panel blankslate markdown-preview-error" id="diff">
          <Octicon symbol={octicons.alert} />
          <p>Unable to preview {this.props.file.path}.</p>
          <p className="error-details">{error}</p>
        </div>
      )
    }

    if (contents === null) {
      return (
        <div className="panel blankslate" id="diff">
          <Loading /> Reading {this.props.file.path}…
        </div>
      )
    }

    return (
      <div className="markdown-preview" id="diff">
        {this.renderTruncationWarning()}
        <SandboxedMarkdown
          markdown={contents}
          baseHref={this.baseHref}
          emoji={this.props.emoji}
          onMarkdownLinkClicked={this.props.onMarkdownLinkClicked}
          underlineLinks={true}
          linebreaks={false}
          customCSS={PreviewStyles}
          ariaLabel={`Preview of ${this.props.file.path}`}
        />
      </div>
    )
  }

  private renderTruncationWarning() {
    if (!this.state.truncated) {
      return null
    }

    return (
      <div className="markdown-preview-truncated">
        <Octicon symbol={octicons.alert} /> This file is too big to preview in
        full - showing the first {MaxPreviewContentLength / 1024}KB.
      </div>
    )
  }
}
