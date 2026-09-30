import * as React from 'react'
import classNames from 'classnames'

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
  readonly onHover: (path: string | null) => void
  readonly onActivate: (path: string) => void
}

interface IDrawingBoxProps {
  readonly box: IDrawingBox
  readonly highlighted: boolean
  readonly uninitialized: boolean
  readonly onHover: (path: string | null) => void
  readonly onActivate: (path: string) => void
}

class DrawingBlock extends React.Component<IDrawingBoxProps> {
  private onMouseEnter = () => this.props.onHover(this.props.box.path)
  private onMouseLeave = () => this.props.onHover(null)
  private onClick = () => this.props.onActivate(this.props.box.path)

  public render() {
    const { box, highlighted, uninitialized } = this.props
    return (
      <g
        className={classNames('exploded-block', box.kind, {
          highlighted,
          uninitialized,
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
    const { box, highlighted, uninitialized } = this.props
    const [cx, cy] = box.callout
    return (
      <g
        className={classNames('exploded-callout', box.kind, {
          highlighted,
          uninitialized,
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
  public render() {
    const { parts, highlightedPath, uninitializedPaths, onHover, onActivate } =
      this.props
    if (parts.length === 0) {
      return null
    }

    const drawing = layoutExplodedDrawing(parts)
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
              onHover={onHover}
              onActivate={onActivate}
            />
          ))}
        </svg>
      </div>
    )
  }
}
