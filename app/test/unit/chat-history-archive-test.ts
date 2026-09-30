import assert from 'node:assert'
import { describe, it, beforeEach, afterEach } from 'node:test'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'fs/promises'
import * as Os from 'os'
import * as Path from 'path'
import { archiveCandidate } from '../../src/lib/chat-history-archive'
import {
  DefaultChatHistoryArchiveConfig,
  IChatHistoryArchiveConfig,
} from '../../src/models/chat-history-archive'
import { Repository } from '../../src/models/repository'

async function write(path: string, contents: string) {
  await mkdir(Path.dirname(path), { recursive: true })
  await writeFile(path, contents)
}

const read = (path: string) => readFile(path, 'utf8')

describe('chat history archive', () => {
  let root: string
  let repoPath: string
  let archivePath: string
  let config: IChatHistoryArchiveConfig

  const candidateFor = (watchDir: string) => ({
    repository: { path: repoPath, name: 'demo' } as unknown as Repository,
    watchDir,
    sourcePath: Path.join(repoPath, watchDir),
  })

  beforeEach(async () => {
    root = await mkdtemp(Path.join(Os.tmpdir(), 'chat-archive-test-'))
    repoPath = Path.join(root, 'demo')
    archivePath = Path.join(root, 'archive')
    config = { ...DefaultChatHistoryArchiveConfig, enabled: true, archivePath }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('moves a first-time history folder and links it back', async () => {
    await write(Path.join(repoPath, '.claude', 'a.md'), 'first')

    const result = await archiveCandidate(candidateFor('.claude'), config)

    assert.ok(result.success, result.error)
    const archived = Path.join(archivePath, 'demo', '.claude')
    assert.strictEqual(await read(Path.join(archived, 'a.md')), 'first')
    assert.ok((await lstat(Path.join(repoPath, '.claude'))).isSymbolicLink())
  })

  it('keeps a history file whose name is already archived', async () => {
    // Already archived once, then the folder came back with a new file of
    // the same name — the case that used to be deleted outright.
    await write(Path.join(archivePath, 'demo', '.claude', 'chat.md'), 'old')
    await write(Path.join(repoPath, '.claude', 'chat.md'), 'new')

    const result = await archiveCandidate(candidateFor('.claude'), config)

    assert.ok(result.success, result.error)
    const archived = Path.join(archivePath, 'demo', '.claude')
    const names = (await readdir(archived)).filter(f => f.startsWith('chat'))
    const contents = (
      await Promise.all(names.map(f => read(Path.join(archived, f))))
    ).sort()
    assert.deepStrictEqual(contents, ['new', 'old'])
  })

  it('merges nested folders instead of dropping them', async () => {
    await write(
      Path.join(archivePath, 'demo', '.claude', 'logs', 'one.md'),
      '1'
    )
    await write(Path.join(repoPath, '.claude', 'logs', 'two.md'), '2')

    const result = await archiveCandidate(candidateFor('.claude'), config)

    assert.ok(result.success, result.error)
    const logs = Path.join(archivePath, 'demo', '.claude', 'logs')
    assert.deepStrictEqual((await readdir(logs)).sort(), ['one.md', 'two.md'])
  })

  it('drops a file only when it is identical to the archived copy', async () => {
    await write(Path.join(archivePath, 'demo', '.claude', 'same.md'), 'same')
    await write(Path.join(repoPath, '.claude', 'same.md'), 'same')

    const result = await archiveCandidate(candidateFor('.claude'), config)

    assert.ok(result.success, result.error)
    assert.deepStrictEqual(
      await readdir(Path.join(archivePath, 'demo', '.claude')),
      ['same.md']
    )
  })

  it('refuses to archive without an absolute archive path', async () => {
    await write(Path.join(repoPath, '.claude', 'a.md'), 'stay')

    const result = await archiveCandidate(candidateFor('.claude'), {
      ...config,
      archivePath: '',
    })

    assert.strictEqual(result.success, false)
    const source = Path.join(repoPath, '.claude')
    assert.ok(!(await lstat(source)).isSymbolicLink())
    assert.strictEqual(await read(Path.join(source, 'a.md')), 'stay')
  })
})
