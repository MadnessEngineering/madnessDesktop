import assert from 'node:assert'
import { describe, it } from 'node:test'
import {
  IDrawingPartInput,
  drawingLabelText,
  iso,
  layoutExplodedDrawing,
  toPoints,
} from '../../src/lib/exploded-drawing'

function part(
  label: string,
  byteSize: number,
  kind: IDrawingPartInput['kind'] = 'folder'
): IDrawingPartInput {
  return { path: label.toLowerCase(), label, name: label, kind, byteSize }
}

const topHeight = (pts: ReadonlyArray<readonly [number, number]>) =>
  Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]))

describe('exploded drawing', () => {
  it('projects ground points isometrically, lifting z straight up', () => {
    assert.deepStrictEqual(iso(0, 0, 0), [0, 0])
    const [x, y] = iso(10, 0, 0)
    assert.ok(x > 0 && y > 0)
    assert.deepStrictEqual(iso(0, 0, 5), [0, -5])
  })

  it('lays out one box per part, back to front', () => {
    const d = layoutExplodedDrawing([
      part('A', 10),
      part('B', 20),
      part('C', 5),
    ])
    assert.strictEqual(d.boxes.length, 3)
    // 2 columns: A (0,0) is farthest back and paints first.
    assert.strictEqual(d.boxes[0].label, 'A')
  })

  it('draws a heavier folder as a bigger block', () => {
    const d = layoutExplodedDrawing([part('Big', 1000), part('Small', 10)])
    const big = d.boxes.find(b => b.label === 'Big')!
    const small = d.boxes.find(b => b.label === 'Small')!
    assert.ok(topHeight(big.top) > topHeight(small.top))
  })

  it('draws every submodule at the same stock size', () => {
    const d = layoutExplodedDrawing([
      part('S1', 0, 'submodule'),
      part('S2', 99999, 'submodule'),
    ])
    assert.strictEqual(topHeight(d.boxes[0].top), topHeight(d.boxes[1].top))
  })

  it('drops a line from each block straight down to the plate', () => {
    const d = layoutExplodedDrawing([part('A', 1)])
    const [from, to] = d.boxes[0].drop
    assert.strictEqual(from[0], to[0])
    assert.ok(to[1] > from[1])
  })

  it('fits every block, callout and label inside the view box', () => {
    const d = layoutExplodedDrawing(
      Array.from({ length: 11 }, (_, i) => part(`Part${i}`, i * 100))
    )
    const [vx, vy, vw, vh] = d.viewBox
    for (const b of d.boxes) {
      for (const [x, y] of [...b.top, ...b.left, ...b.right, b.callout]) {
        assert.ok(x >= vx && x <= vx + vw && y >= vy && y <= vy + vh)
      }
    }
  })

  it('handles nothing to draw', () => {
    const d = layoutExplodedDrawing([])
    assert.strictEqual(d.boxes.length, 0)
    assert.ok(d.viewBox.every(Number.isFinite))
  })

  it('shortens long names and formats polygon points', () => {
    assert.strictEqual(drawingLabelText('short'), 'short')
    assert.strictEqual(
      drawingLabelText('.eval-corpus-rewrite-artifacts'),
      '.eval-corpus-re…'
    )
    assert.strictEqual(
      toPoints([
        [1, 2],
        [3.25, 4],
      ]),
      '1.0,2.0 3.3,4.0'
    )
  })
})
