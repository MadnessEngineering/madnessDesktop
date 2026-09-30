/**
 * Geometry for the exploded view's isometric drawing: each part a block
 * sized by its weight, lifted off a base plate, with a dashed drop line to
 * the footprint it sits in and a lettered callout on a leader line.
 *
 * Pure numbers in, SVG-ready polygons out — the component only paints.
 */

export type DrawingPartKind = 'folder' | 'submodule'

export interface IDrawingPartInput {
  readonly path: string
  readonly label: string
  readonly name: string
  readonly kind: DrawingPartKind
  /** Committed bytes; ignored for submodules, which draw at a fixed size. */
  readonly byteSize: number
  /** A short tag drawn after the name, e.g. a paint count. */
  readonly badge?: string
}

export type Point = readonly [number, number]

export interface IDrawingBox {
  readonly path: string
  readonly label: string
  readonly name: string
  readonly kind: DrawingPartKind
  readonly badge?: string
  readonly top: ReadonlyArray<Point>
  readonly left: ReadonlyArray<Point>
  readonly right: ReadonlyArray<Point>
  /** The block's outline on the base plate. */
  readonly footprint: ReadonlyArray<Point>
  /** Dashed line from the underside of the block down to the plate. */
  readonly drop: readonly [Point, Point]
  /** Leader line from the block's top corner out to the callout. */
  readonly leader: readonly [Point, Point]
  readonly callout: Point
}

export interface IExplodedDrawing {
  /** Painter's order: back to front. */
  readonly boxes: ReadonlyArray<IDrawingBox>
  readonly plate: ReadonlyArray<Point>
  readonly viewBox: readonly [number, number, number, number]
}

/** Ground units per grid cell. */
const Cell = 100
const Cos30 = Math.cos(Math.PI / 6)
const Sin30 = 0.5

/** Average width of a label character at the drawing's font size. */
const CharWidth = 5.6
const MaxLabelChars = 16
const CalloutRadius = 9

/**
 * Columns × rows for n parts: the fewest empty cells, then the wider grid —
 * an empty cell is a hole in the plate, and the sheet is wider than tall.
 * Never more than twice as wide as deep, or the plate thins to a diagonal
 * plank.
 */
export function gridFor(n: number): readonly [number, number] {
  if (n <= 1) {
    return [1, 1]
  }
  const lo = Math.ceil(Math.sqrt(n))
  const hi = Math.max(lo, Math.ceil(Math.sqrt(n * 2.5)))
  let best: [number, number] = [lo, Math.ceil(n / lo)]
  for (let cols = lo; cols <= hi; cols++) {
    const rows = Math.ceil(n / cols)
    if (cols > rows * 2) {
      continue
    }
    if (cols * rows - n <= best[0] * best[1] - n) {
      best = [cols, rows]
    }
  }
  return best
}

/** Project ground coordinates (x, y) at height z onto the page. */
export function iso(x: number, y: number, z: number): Point {
  return [(x - y) * Cos30, (x + y) * Sin30 - z]
}

/** The name as drawn beside its callout, shortened to fit. */
export function drawingLabelText(name: string): string {
  return name.length > MaxLabelChars
    ? `${name.slice(0, MaxLabelChars - 1)}…`
    : name
}

export function layoutExplodedDrawing(
  parts: ReadonlyArray<IDrawingPartInput>
): IExplodedDrawing {
  const n = parts.length
  const [cols, rows] = gridFor(n)
  // Empty cells go at the back corner, where the lifted blocks of the rows
  // in front cover for them — never the front tip of the plate.
  const empty = cols * rows - n
  const maxBytes = parts.reduce(
    (max, p) => (p.kind === 'folder' ? Math.max(max, p.byteSize) : max),
    0
  )

  const boxes = parts.map((part, i) => {
    const cell = i + empty
    const col = cell % cols
    const row = Math.floor(cell / cols)
    const cx = col * Cell + Cell / 2
    const cy = row * Cell + Cell / 2

    // Square roots so one giant folder doesn't shrink everything else to
    // specks; submodules are bought-in hardware, drawn at a stock size.
    const weight =
      part.kind === 'submodule' || maxBytes === 0
        ? 0
        : Math.sqrt(part.byteSize / maxBytes)
    const hs =
      part.kind === 'submodule' ? Cell * 0.24 : Cell * (0.14 + 0.24 * weight)
    const h = part.kind === 'submodule' ? 26 : 10 + 56 * weight

    // Stagger the lift so the parts read as pulled apart, not stacked.
    const lift = 28 + ((col + row * 2) % 3) * 18
    const z1 = lift + h

    const x0 = cx - hs
    const x1 = cx + hs
    const y0 = cy - hs
    const y1 = cy + hs

    const topCorner = iso(x1, y0, z1)
    const callout: Point = [topCorner[0] + 16, topCorner[1] - 16]

    const box: IDrawingBox = {
      path: part.path,
      label: part.label,
      name: part.name,
      kind: part.kind,
      badge: part.badge,
      top: [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)],
      left: [
        iso(x0, y1, lift),
        iso(x1, y1, lift),
        iso(x1, y1, z1),
        iso(x0, y1, z1),
      ],
      right: [
        iso(x1, y0, lift),
        iso(x1, y1, lift),
        iso(x1, y1, z1),
        iso(x1, y0, z1),
      ],
      footprint: [
        iso(x0, y0, 0),
        iso(x1, y0, 0),
        iso(x1, y1, 0),
        iso(x0, y1, 0),
      ],
      drop: [iso(cx, cy, lift), iso(cx, cy, 0)],
      leader: [topCorner, callout],
      callout,
    }
    return { box, depth: col + row }
  })

  // Farther parts (smaller x + y) paint first so nearer blocks overlap them.
  const ordered = boxes
    .slice()
    .sort((a, b) => a.depth - b.depth)
    .map(b => b.box)

  const pad = Cell * 0.12
  const plate = [
    iso(-pad, -pad, 0),
    iso(cols * Cell + pad, -pad, 0),
    iso(cols * Cell + pad, rows * Cell + pad, 0),
    iso(-pad, rows * Cell + pad, 0),
  ]

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const include = ([x, y]: Point) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  // Frame what's drawn, not the whole plate: the plate runs on past the
  // edges like the cut-off base in a manual's detail view, and the parts get
  // the room its empty corners would have taken.
  if (ordered.length === 0) {
    plate.forEach(include)
  }
  for (const b of ordered) {
    b.top.forEach(include)
    b.footprint.forEach(include)
    const [cxp, cyp] = b.callout
    include([cxp - CalloutRadius, cyp - CalloutRadius])
    include([
      cxp + CalloutRadius + 6 + calloutText(b).length * CharWidth,
      cyp + CalloutRadius,
    ])
  }

  const margin = 8
  return {
    boxes: ordered,
    plate,
    viewBox: [
      minX - margin,
      minY - margin,
      maxX - minX + margin * 2,
      maxY - minY + margin * 2,
    ],
  }
}

/** Everything drawn beside a callout: the name, then its badge if any. */
export function calloutText(part: { name: string; badge?: string }): string {
  const name = drawingLabelText(part.name)
  return part.badge ? `${name} · ${part.badge}` : name
}

/** SVG `points` attribute for a polygon. */
export function toPoints(points: ReadonlyArray<Point>): string {
  return points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
}
