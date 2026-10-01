import { describe, it } from 'node:test'
import assert from 'node:assert'
import { mkdir, readFile, symlink, writeFile } from 'fs/promises'
import { pathExists } from '../../../src/lib/path-exists'
import * as Path from 'path'
import { exec } from 'dugite'

import { setupEmptyRepository } from '../../helpers/repositories'
import { getStatusOrThrow } from '../../helpers/status'
import {
  saveGitIgnore,
  readGitIgnoreAtRoot,
  appendIgnoreRule,
  escapeGitSpecialCharacters,
  appendIgnoreFile,
  ignoreAndUntrack,
  createCommit,
} from '../../../src/lib/git'
import { Repository } from '../../../src/models/repository'
import { AppFileStatusKind } from '../../../src/models/status'
import { setupLocalConfig } from '../../helpers/local-config'

describe('gitignore', () => {
  describe('readGitIgnoreAtRoot', () => {
    it('returns null when .gitignore does not exist on disk', async t => {
      const repo = await setupEmptyRepository(t)

      const gitignore = await readGitIgnoreAtRoot(repo)

      assert(gitignore === null)
    })

    it('reads contents from disk', async t => {
      const repo = await setupEmptyRepository(t)
      const path = repo.path

      const expected = 'node_modules\nyarn-error.log\n'

      const ignoreFile = `${path}/.gitignore`
      await writeFile(ignoreFile, expected)

      const gitignore = await readGitIgnoreAtRoot(repo)

      assert.equal(gitignore, expected)
    })

    it('rejects a symbolic link', async t => {
      const repo = await setupEmptyRepository(t)
      const targetPath = Path.join(repo.path, 'target')

      await writeFile(targetPath, 'target contents')
      await symlink(targetPath, Path.join(repo.path, '.gitignore'))

      await assert.rejects(
        readGitIgnoreAtRoot(repo),
        /Cannot use a symbolic link as the root .gitignore file/
      )
    })

    it('rejects a dangling symbolic link', async t => {
      const repo = await setupEmptyRepository(t)
      const targetPath = Path.join(repo.path, 'missing-target')

      await symlink(targetPath, Path.join(repo.path, '.gitignore'))

      await assert.rejects(
        readGitIgnoreAtRoot(repo),
        /Cannot use a symbolic link as the root .gitignore file/
      )
    })

    it('when autocrlf=true and safecrlf=true, appends CRLF to file', async t => {
      const repo = await setupEmptyRepository(t)

      await setupLocalConfig(repo, [
        ['core.autocrlf', 'true'],
        ['core.safecrlf', 'true'],
      ])

      const { path } = repo

      await saveGitIgnore(repo, 'node_modules')
      await exec(['add', '.gitignore'], path)

      const commit = await exec(
        ['commit', '-m', 'create the ignore file'],
        path
      )
      assert.equal(commit.exitCode, 0)

      const contents = await readGitIgnoreAtRoot(repo)
      assert(contents !== null)
      assert(contents.endsWith('\r\n'))
    })

    it('when autocrlf=input, appends LF to file', async t => {
      const repo = await setupEmptyRepository(t)

      setupLocalConfig(repo, [
        // ensure this repository only ever sticks to LF
        ['core.eol', 'lf'],
        // do not do any conversion of line endings when committing
        ['core.autocrlf', 'input'],
      ])

      const { path } = repo

      await saveGitIgnore(repo, 'node_modules')
      await exec(['add', '.gitignore'], path)

      const commit = await exec(
        ['commit', '-m', 'create the ignore file'],
        path
      )
      assert.equal(commit.exitCode, 0)

      const contents = await readGitIgnoreAtRoot(repo)
      assert(contents !== null)
      assert(contents.endsWith('\n'))
    })
  })

  describe('saveGitIgnore', () => {
    it(`creates gitignore file when it doesn't exist`, async t => {
      const repo = await setupEmptyRepository(t)

      await saveGitIgnore(repo, 'node_modules\n')

      const exists = await pathExists(`${repo.path}/.gitignore`)

      assert(exists)
    })

    it('rejects a symbolic link without modifying its target', async t => {
      const repo = await setupEmptyRepository(t)
      const targetPath = Path.join(repo.path, 'target')

      await writeFile(targetPath, 'target contents')
      await symlink(targetPath, Path.join(repo.path, '.gitignore'))

      await assert.rejects(
        saveGitIgnore(repo, 'node_modules\n'),
        /Cannot use a symbolic link as the root .gitignore file/
      )
      assert.equal(await readFile(targetPath, 'utf8'), 'target contents')
    })

    it('rejects a dangling symbolic link', async t => {
      const repo = await setupEmptyRepository(t)
      const targetPath = Path.join(repo.path, 'missing-target')

      await symlink(targetPath, Path.join(repo.path, '.gitignore'))

      await assert.rejects(
        saveGitIgnore(repo, 'node_modules\n'),
        /Cannot use a symbolic link as the root .gitignore file/
      )
    })

    it('deletes gitignore file when no entries provided', async t => {
      const repo = await setupEmptyRepository(t)
      const path = repo.path

      const ignoreFile = `${path}/.gitignore`
      await writeFile(ignoreFile, 'node_modules\n')

      // update gitignore file to be empty
      await saveGitIgnore(repo, '')

      const exists = await pathExists(ignoreFile)
      assert(!exists)
    })

    it('applies rule correctly to repository', async t => {
      const repo = await setupEmptyRepository(t)

      const path = repo.path

      await saveGitIgnore(repo, '*.txt\n')
      await exec(['add', '.gitignore'], path)
      await exec(['commit', '-m', 'create the ignore file'], path)

      // Create a txt file
      const file = Path.join(repo.path, 'a.txt')

      await writeFile(file, 'thrvbnmerkl;,iuw')

      // Check status of repo
      const status = await getStatusOrThrow(repo)
      const files = status.workingDirectory.files

      assert.equal(files.length, 0)
    })

    it('escapes string with special git characters', async () => {
      const unescapedFilePath = '[never]\\!gonna*give#you?_.up'
      const escapedFilePath = '\\[never\\]\\\\!gonna\\*give\\#you\\?_.up'

      const result = escapeGitSpecialCharacters(unescapedFilePath)
      assert.equal(result, escapedFilePath)
    })
  })

  describe('appendIgnoreRule', () => {
    it('appends one rule', async t => {
      const repo = await setupEmptyRepository(t)

      await setupLocalConfig(repo, [['core.autocrlf', 'true']])

      const { path } = repo

      const ignoreFile = `${path}/.gitignore`
      await writeFile(ignoreFile, 'node_modules\n')

      await appendIgnoreRule(repo, ['yarn-error.log'])

      const gitignore = await readFile(ignoreFile)

      const expected = 'node_modules\nyarn-error.log\n'
      assert.equal(gitignore.toString('utf8'), expected)
    })

    it('appends multiple rules', async t => {
      const repo = await setupEmptyRepository(t)

      await setupLocalConfig(repo, [['core.autocrlf', 'true']])

      const { path } = repo

      const ignoreFile = `${path}/.gitignore`
      await writeFile(ignoreFile, 'node_modules\n')

      await appendIgnoreRule(repo, ['yarn-error.log', '.eslintcache', 'dist/'])

      const gitignore = await readFile(ignoreFile)

      const expected = 'node_modules\nyarn-error.log\n.eslintcache\ndist/\n'
      assert.equal(gitignore.toString('utf8'), expected)
    })

    it('appends one file containing special characters', async t => {
      const repo = await setupEmptyRepository(t)

      await setupLocalConfig(repo, [['core.autocrlf', 'true']])

      const { path } = repo

      const ignoreFile = `${path}/.gitignore`
      await writeFile(ignoreFile, 'node_modules\n')

      const fileToIgnore = '[never]!gonna*give#you?_.up'
      await appendIgnoreFile(repo, [fileToIgnore])

      const gitignore = await readFile(ignoreFile)

      const expected =
        'node_modules\n' + '\\[never\\]\\!gonna\\*give\\#you\\?_.up\n'
      assert.equal(gitignore.toString('utf8'), expected)
    })
  })

  describe('appendIgnoreFile', () => {
    it('ignores an untracked file a deeper .gitignore re-includes', async t => {
      const repo = await setupEmptyRepository(t)
      await mkdir(Path.join(repo.path, 'a/b'), { recursive: true })
      await writeFile(Path.join(repo.path, 'a/.gitignore'), '!b/**\n')
      await writeFile(Path.join(repo.path, 'a/b/.gitignore'), '!c.txt\n')
      await writeFile(Path.join(repo.path, 'a/b/c.txt'), 'c\n')

      await appendIgnoreFile(repo, 'a/b/c.txt')

      const deepest = await readFile(Path.join(repo.path, 'a/b/.gitignore'))
      assert.equal(
        deepest.toString('utf8').replace(/\r\n/g, '\n'),
        '!c.txt\n/c.txt\n'
      )
      const status = await getStatusOrThrow(repo)
      assert.deepEqual(status.workingDirectory.files.map(f => f.path).sort(), [
        '.gitignore',
        'a/.gitignore',
        'a/b/.gitignore',
      ])
    })

    it('leaves deeper .gitignore files alone when not needed', async t => {
      const repo = await setupEmptyRepository(t)
      await mkdir(Path.join(repo.path, 'a'), { recursive: true })
      await writeFile(Path.join(repo.path, 'a/.gitignore'), 'other.txt\n')
      await writeFile(Path.join(repo.path, 'a/c.txt'), 'c\n')

      await appendIgnoreFile(repo, 'a/c.txt')

      const nested = await readFile(Path.join(repo.path, 'a/.gitignore'))
      assert.equal(
        nested.toString('utf8').replace(/\r\n/g, '\n'),
        'other.txt\n'
      )
    })
  })

  describe('ignoreAndUntrack', () => {
    const commitFiles = async (
      repo: Repository,
      files: Record<string, string>
    ) => {
      for (const [file, contents] of Object.entries(files)) {
        await mkdir(Path.dirname(Path.join(repo.path, file)), {
          recursive: true,
        })
        await writeFile(Path.join(repo.path, file), contents)
      }
      await exec(['add', '.'], repo.path)
      const commit = await exec(['commit', '-m', 'add files'], repo.path)
      assert.equal(commit.exitCode, 0)
    }

    const statusKinds = async (repo: Repository) => {
      const status = await getStatusOrThrow(repo)
      return new Map(
        status.workingDirectory.files.map(f => [f.path, f.status.kind])
      )
    }

    const ignoreRules = async (repo: Repository) =>
      ((await readGitIgnoreAtRoot(repo)) ?? '')
        .split(/\r?\n/)
        .filter(line => line.length > 0)

    const trackedFiles = async (repo: Repository) => {
      const result = await exec(['ls-files'], repo.path)
      return result.stdout.split('\n').filter(line => line.length > 0)
    }

    it('ignores a tracked file and untracks it, keeping it on disk', async t => {
      const repo = await setupEmptyRepository(t)
      await commitFiles(repo, { 'junk.json': '{}\n' })
      await writeFile(Path.join(repo.path, 'junk.json'), '{"churn":1}\n')

      await ignoreAndUntrack(repo, 'junk.json')

      assert.deepEqual(await ignoreRules(repo), ['junk.json'])
      const kinds = await statusKinds(repo)
      assert.equal(kinds.get('junk.json'), AppFileStatusKind.Deleted)
      assert(await pathExists(Path.join(repo.path, 'junk.json')))
    })

    it('untracks every file under a root-anchored folder', async t => {
      const repo = await setupEmptyRepository(t)
      await commitFiles(repo, {
        'a/b/x.txt': 'x\n',
        'a/b/y.txt': 'y\n',
        'keep.txt': 'keep\n',
      })

      await ignoreAndUntrack(repo, '/a/b')

      assert.deepEqual(await ignoreRules(repo), ['/a/b'])
      const kinds = await statusKinds(repo)
      assert.equal(kinds.get('a/b/x.txt'), AppFileStatusKind.Deleted)
      assert.equal(kinds.get('a/b/y.txt'), AppFileStatusKind.Deleted)
      assert.equal(kinds.has('keep.txt'), false)
      assert.deepEqual(await trackedFiles(repo), ['keep.txt'])
    })

    it('does not fail on untracked paths in the list', async t => {
      const repo = await setupEmptyRepository(t)
      await commitFiles(repo, { 'tracked.txt': 'tracked\n' })
      await writeFile(Path.join(repo.path, 'new.txt'), 'new\n')

      await ignoreAndUntrack(repo, ['tracked.txt', 'new.txt'])

      const kinds = await statusKinds(repo)
      assert.equal(kinds.get('tracked.txt'), AppFileStatusKind.Deleted)
      assert.equal(kinds.has('new.txt'), false)
    })

    it('matches paths literally, not as globs', async t => {
      const repo = await setupEmptyRepository(t)
      await commitFiles(repo, { 'foo[1].txt': 'a\n', 'foo1.txt': 'b\n' })

      await ignoreAndUntrack(repo, 'foo[1].txt')

      assert.deepEqual(await trackedFiles(repo), ['foo1.txt'])
      const kinds = await statusKinds(repo)
      assert.equal(kinds.get('foo[1].txt'), AppFileStatusKind.Deleted)
      assert.equal(kinds.has('foo1.txt'), false)
    })

    it('outranks a deeper .gitignore that re-includes the file', async t => {
      const repo = await setupEmptyRepository(t)
      await commitFiles(repo, {
        'sub/.gitignore': '!skills/**\n',
        'sub/skills/manifest.json': '{}\n',
        'sub/skills/keep.md': 'keep\n',
      })

      await ignoreAndUntrack(repo, 'sub/skills/manifest.json')

      assert.deepEqual(await ignoreRules(repo), ['sub/skills/manifest.json'])
      const nested = await readFile(Path.join(repo.path, 'sub/.gitignore'))
      assert.equal(
        nested.toString('utf8').replace(/\r\n/g, '\n'),
        '!skills/**\n/skills/manifest.json\n'
      )

      const kinds = await statusKinds(repo)
      assert.equal(
        kinds.get('sub/skills/manifest.json'),
        AppFileStatusKind.Deleted
      )
      assert.equal(kinds.has('sub/skills/keep.md'), false)
      const checkIgnore = await exec(
        ['check-ignore', '--no-index', 'sub/skills/manifest.json'],
        repo.path
      )
      assert.equal(checkIgnore.exitCode, 0)
    })

    it('keeps the file untracked and ignored once committed', async t => {
      const repo = await setupEmptyRepository(t)
      await commitFiles(repo, { 'junk.json': '{}\n' })

      await ignoreAndUntrack(repo, 'junk.json')

      const status = await getStatusOrThrow(repo)
      await createCommit(
        repo,
        'Ignore junk.json',
        status.workingDirectory.files
      )

      assert.deepEqual(await trackedFiles(repo), ['.gitignore'])
      assert.equal((await statusKinds(repo)).size, 0)
      const checkIgnore = await exec(['check-ignore', 'junk.json'], repo.path)
      assert.equal(checkIgnore.exitCode, 0)
      assert(await pathExists(Path.join(repo.path, 'junk.json')))
    })
  })
})
