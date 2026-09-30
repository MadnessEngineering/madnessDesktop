import * as React from 'react'
import classNames from 'classnames'
import memoizeOne from 'memoize-one'

import {
  IDrawingBox,
  IDrawingPartInput,
  drawingLabelText,
  layoutExplodedDrawing,
  toPoints,
} from '../../lib/exploded-drawing'

interface IExplodedDrawingProps {
  readonly parts: ReadonlyArray<IDrawingPartInput>
  /** The part hovered here or on its card; drawn highlighted. */
  readonly highlightedPath: string | null
  /** Paths of submodules with nothing checked out yet. */
  readonly uninitializedPaths: ReadonlySet<string>
  /** How strongly to paint each part's left face amber, 0–1, by path. */
  readonly paint: ReadonlyMap<string, number>
  readonly onHover: (path: string | null) => void
  readonly onActivate: (path: string) => void
}

interface IDrawingBoxProps {
  readonly box: IDrawingBox
  readonly highlighted: boolean
  readonly uninitialized: boolean
  readonly paint: number
  readonly onHover: (path: string | null) => void
  readonly onActivate: (path: string) => void
}

class DrawingBlock extends React.Component<IDrawingBoxProps> {
  private onMouseEnter = () => this.props.onHover(this.props.box.path)
  private onMouseLeave = () => this.props.onHover(null)
  private onClick = () => this.props.onActivate(this.props.box.path)

  public render() {
    const { box, highlighted, uninitialized, paint } = this.props
    return (
      <g
        className={classNames('exploded-block', box.kind, {
          highlighted,
          uninitialized,
          painted: paint > 0,
        })}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        onClick={this.onClick}
      >
        <line
          className="exploded-block-drop"
          x1={box.drop[0][0]}
          y1={box.drop[0][1]}
          x2={box.drop[1][0]}
          y2={box.drop[1][1]}
        />
        <polygon className="face left" points={toPoints(box.left)} />
        {paint > 0 && (
          // One side painted, the rest left as drawn: the part is marked for
          // work without losing the blueprint.
          <polygon
            className="face paint"
            points={toPoints(box.left)}
            style={{ fillOpacity: paint }}
          />
        )}
        <polygon className="face right" points={toPoints(box.right)} />
        <polygon className="face top" points={toPoints(box.top)} />
      </g>
    )
  }
}

class DrawingCallout extends React.Component<IDrawingBoxProps> {
  private onMouseEnter = () => this.props.onHover(this.props.box.path)
  private onMouseLeave = () => this.props.onHover(null)
  private onClick = () => this.props.onActivate(this.props.box.path)

  public render() {
    const { box, highlighted, uninitialized, paint } = this.props
    const [cx, cy] = box.callout
    return (
      <g
        className={classNames('exploded-callout', box.kind, {
          highlighted,
          uninitialized,
          painted: paint > 0,
        })}
        onMouseEnter={this.onMouseEnter}
        onMouseLeave={this.onMouseLeave}
        onClick={this.onClick}
      >
        <line
          className="exploded-callout-leader"
          x1={box.leader[0][0]}
          y1={box.leader[0][1]}
          x2={box.leader[1][0]}
          y2={box.leader[1][1]}
        />
        <circle cx={cx} cy={cy} r={9} />
        <text className="exploded-callout-letter" x={cx} y={cy}>
          {box.label}
        </text>
        <text className="exploded-callout-name" x={cx + 13} y={cy}>
          {drawingLabelText(box.name)}
          {box.badge && (
            <tspan className="exploded-callout-badge"> · {box.badge}</tspan>
          )}
        </text>
      </g>
    )
  }
}

/**
 * The isometric exploded drawing at the top of the sheet. Decorative for
 * assistive tech — the part cards below carry the same actions as buttons.
 */
export class ExplodedDrawing extends React.Component<IExplodedDrawingProps> {
  // Hovering re-renders on every block crossed; lay out only when the parts
  // themselves change.
  private layout = memoizeOne(layoutExplodedDrawing)

  public render() {
    const {
      parts,
      highlightedPath,
      uninitializedPaths,
      paint,
      onHover,
      onActivate,
    } = this.props
    if (parts.length === 0) {
      return null
    }

    const drawing = this.layout(parts)
    const [vx, vy, vw, vh] = drawing.viewBox

    return (
      <div className="exploded-drawing" aria-hidden={true}>
        <svg
          aria-hidden={true}
          viewBox={`${vx} ${vy} ${vw} ${vh}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ maxHeight: `${Math.min(vh * 1.6, 560)}px` }}
        >
          <polygon
            className="exploded-plate"
            points={toPoints(drawing.plate)}
          />
          {drawing.boxes.map(box => (
            <polygon
              key={box.path}
              className={classNames('exploded-footprint', box.kind, {
                highlighted: box.path === highlightedPath,
              })}
              points={toPoints(box.footprint)}
            />
          ))}
          {drawing.boxes.map(box => (
            <DrawingBlock
              key={box.path}
              box={box}
              highlighted={box.path === highlightedPath}
              uninitialized={uninitializedPaths.has(box.path)}
              paint={paint.get(box.path) ?? 0}
              onHover={onHover}
              onActivate={onActivate}
            />
          ))}
          {drawing.boxes.map(box => (
            <DrawingCallout
              key={box.path}
              box={box}
              highlighted={box.path === highlightedPath}
              uninitialized={uninitializedPaths.has(box.path)}
              paint={paint.get(box.path) ?? 0}
              onHover={onHover}
              onActivate={onActivate}
            />
          ))}
        </svg>
      </div>
    )
  }
}
