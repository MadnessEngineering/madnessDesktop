import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  buildPartsTree,
  countSubmodules,
  findPart,
  parseLsTree,
  partLabel,
} from '../../src/lib/repository-parts'

const oid = '1eaabe34fc6f486367a176207420378f587d3b48'

const lsTree = [
  `100644 blob ${oid}     120\tREADME.md`,
  `100644 blob ${oid}      30\tsrc/index.ts`,
  `100644 blob ${oid}      50\tsrc/lib/util.ts`,
  `100755 blob ${oid}       7\tscript/run me.sh`,
  `160000 commit ${oid}       -\tvendor/engine`,
  `100644 blob ${oid}       3\tdocs/a\ttab.md`,
  '',
].join('\0')

describe('repository parts', () => {
  describe('parseLsTree', () => {
    it('reads mode, size and path, with no size for a submodule', () => {
      const entries = parseLsTree(lsTree)
      assert.strictEqual(entries.length, 6)
      assert.deepStrictEqual(entries[0], {
        mode: '100644',
        path: 'README.md',
        size: 120,
      })
      assert.deepStrictEqual(entries[4], {
        mode: '160000',
        path: 'vendor/engine',
        size: null,
      })
    })

    it('keeps spaces and tabs inside paths', () => {
      const paths = parseLsTree(lsTree).map(e => e.path)
      assert.ok(paths.includes('script/run me.sh'))
      assert.ok(paths.includes('docs/a\ttab.md'))
    })

    it('reads empty output as no entries', () => {
      assert.deepStrictEqual(parseLsTree(''), [])
    })
  })

  describe('buildPartsTree', () => {
    const root = buildPartsTree(parseLsTree(lsTree))

    it('rolls file counts and sizes up to the root', () => {
      assert.strictEqual(root.fileCount, 5)
      assert.strictEqual(root.byteSize, 120 + 30 + 50 + 7 + 3)
    })

    it('orders folders, then submodules, then files', () => {
      assert.deepStrictEqual(
        root.children.map(c => `${c.kind}:${c.name}`),
        [
          'folder:docs',
          'folder:script',
          'folder:src',
          'folder:vendor',
          'file:README.md',
        ]
      )
    })

    it('rolls nested folders into their parents', () => {
      const src = findPart(root, 'src')
      assert.strictEqual(src?.fileCount, 2)
      assert.strictEqual(src?.byteSize, 80)
      assert.strictEqual(findPart(root, 'src/lib')?.path, 'src/lib')
    })

    it('counts a submodule as a part with no files of its own', () => {
      const vendor = findPart(root, 'vendor')
      assert.strictEqual(vendor?.fileCount, 0)
      const engine = findPart(root, 'vendor/engine')
      assert.strictEqual(engine?.kind, 'submodule')
      assert.strictEqual(engine?.byteSize, 0)
    })
  })

  describe('findPart', () => {
    const root = buildPartsTree(parseLsTree(lsTree))

    it('returns the root for the empty path', () => {
      assert.strictEqual(findPart(root, ''), root)
    })

    it('returns null for a missing path or a file', () => {
      assert.strictEqual(findPart(root, 'nope'), null)
      assert.strictEqual(findPart(root, 'README.md'), null)
    })
  })

  describe('countSubmodules', () => {
    const root = buildPartsTree(parseLsTree(lsTree))

    it('counts submodules at any depth', () => {
      assert.strictEqual(countSubmodules(root), 1)
      assert.strictEqual(countSubmodules(findPart(root, 'vendor')!), 1)
      assert.strictEqual(countSubmodules(findPart(root, 'src')!), 0)
    })
  })

  describe('partLabel', () => {
    it('letters parts like spreadsheet columns', () => {
      assert.deepStrictEqual(
        [0, 1, 25, 26, 27, 51, 52, 701, 702].map(partLabel),
        ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']
      )
    })
  })
})
