import { useEffect, useRef, useState } from 'react'
import { floorPolygon, moveEdge, setEdgeLength, validatePolygon } from '../lib/geometry'
import type { FloorSpec, Pt } from '../lib/types'
import { parseLength, toInputText, type UnitSystem } from '../lib/units'

const DIRS = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] } as const
type Dir = keyof typeof DIRS

/** Edge length typed straight onto the wall it belongs to. */
function EdgeInput({ value, units, front, style, onCommit }: { value: number; units: UnitSystem; front: boolean; style: React.CSSProperties; onCommit: (v: number) => void }) {
  const [text, setText] = useState(toInputText(value, units))
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(toInputText(value, units))
    setBad(false)
  }, [value, units])
  const commit = () => {
    const v = parseLength(text, units)
    if (Number.isFinite(v) && v >= 1) {
      setBad(false)
      if (Math.abs(v - value) > 1e-6) onCommit(v)
    } else setBad(true)
  }
  return (
    <input
      className={`edge-input ${front ? 'front' : ''} ${bad ? 'bad' : ''}`}
      style={style}
      value={text}
      inputMode={units === 'metric' ? 'decimal' : 'text'}
      aria-label={front ? 'Front wall length' : 'Wall length'}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), undefined)}
    />
  )
}

interface Drag {
  i: number
  start: Pt
  poly0: Pt[]
  moved: boolean
  vb: { x: number; y: number; w: number; h: number }
}

/** Draw / edit a right-angled floor outline: drag walls, type lengths on them, tap a wall to make it the front. */
export function ShapeEditor({ floor, units, onChange }: { floor: FloorSpec; units: UnitSystem; onChange: (f: FloorSpec) => void }) {
  const poly = floorPolygon(floor)
  const front = floor.frontEdge ?? 0
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const [dragVb, setDragVb] = useState<Drag['vb'] | null>(null)
  const [dir, setDir] = useState<Dir>('right')
  const [len, setLen] = useState(36)
  const drag = useRef<Drag | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const shown = draft ?? poly
  const err = draft ? undefined : validatePolygon(poly)
  const xs = shown.map((p) => p.x)
  const ys = shown.map((p) => p.y)
  const minX = Math.min(...xs, 0)
  const minY = Math.min(...ys, 0)
  const maxX = Math.max(...xs, 0)
  const maxY = Math.max(...ys, 0)
  const pad = Math.max(12, Math.max(maxX - minX, maxY - minY) * 0.12)
  const live = { x: minX - pad, y: minY - pad, w: Math.max(maxX - minX, 24) + pad * 2, h: Math.max(maxY - minY, 24) + pad * 2 }
  // Freeze the frame while dragging so the pointer maps to a fixed plan and the drawing doesn't rescale under the cursor
  const vb = dragVb ?? live

  const commit = (pts: Pt[]) => onChange({ ...floor, shape: 'poly', poly: pts, frontEdge: Math.min(front, pts.length - 1) })

  const addPoint = (pt: Pt) => {
    const d = draft ?? []
    const last = d[d.length - 1]
    let q = { x: Math.round(pt.x * 4) / 4, y: Math.round(pt.y * 4) / 4 }
    if (last) q = Math.abs(q.x - last.x) >= Math.abs(q.y - last.y) ? { x: q.x, y: last.y } : { x: last.x, y: q.y }
    if (last && q.x === last.x && q.y === last.y) return
    setDraft([...d, q])
  }
  const addTyped = () => {
    const d = draft ?? [{ x: 0, y: 0 }]
    const last = d[d.length - 1]
    const [dx, dy] = DIRS[dir]
    setDraft([...d, { x: last.x + dx * len, y: last.y + dy * len }])
  }
  const finish = () => {
    if (!draft || draft.length < 2) return
    const pts = [...draft]
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (last.x !== first.x && last.y !== first.y) pts.push({ x: first.x, y: last.y })
    else if (pts.length >= 2 && last.x === first.x && last.y === first.y) pts.pop()
    commit(pts)
    setDraft(null)
  }
  const svgPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: vb.x + ((e.clientX - r.left) / r.width) * vb.w, y: vb.y + vb.h - ((e.clientY - r.top) / r.height) * vb.h }
  }

  const n = shown.length
  const edgeDir = (pts: Pt[], i: number) => {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    return { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) }
  }
  const keepsShape = (next: Pt[], old: Pt[], i: number) => {
    if (validatePolygon(next)) return false
    return [(i + n - 1) % n, (i + 1) % n].every((k) => {
      const a = edgeDir(old, k)
      const b = edgeDir(next, k)
      return a.x === b.x && a.y === b.y
    })
  }

  const startDrag = (e: React.PointerEvent, i: number) => {
    e.stopPropagation()
    svgRef.current?.setPointerCapture(e.pointerId)
    drag.current = { i, start: svgPoint(e), poly0: poly, moved: false, vb }
    setDragVb(vb)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const pt = svgPoint(e)
    const a = d.poly0[d.i]
    const b = d.poly0[(d.i + 1) % d.poly0.length]
    const horizontal = a.y === b.y
    const delta = Math.round((horizontal ? pt.y - d.start.y : pt.x - d.start.x) * 4) / 4
    if (delta === 0 && !d.moved) return
    d.moved = true
    const next = moveEdge(d.poly0, d.i, delta)
    if (keepsShape(next, d.poly0, d.i)) commit(next)
  }
  const endDrag = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setDragVb(null)
    if (svgRef.current?.hasPointerCapture(e.pointerId)) svgRef.current.releasePointerCapture(e.pointerId)
    if (d && !d.moved) onChange({ ...floor, frontEdge: d.i })
  }

  const path = shown.map((p) => `${p.x},${-p.y}`).join(' ')
  const px = (x: number) => `${((x - vb.x) / vb.w) * 100}%`
  const py = (y: number) => `${((vb.y + vb.h - y) / vb.h) * 100}%`

  return (
    <div className="shape-editor">
      <div className="seg">
        {draft ? (
          <>
            <button onClick={finish} disabled={draft.length < 2}>Close shape</button>
            <button onClick={() => setDraft(draft.slice(0, -1).length ? draft.slice(0, -1) : null)}>Undo point</button>
            <button onClick={() => setDraft(null)}>Cancel</button>
          </>
        ) : (
          <button onClick={() => { setDraft([]); setDir('right') }}>Draw new shape</button>
        )}
      </div>
      {draft && (
        <div className="draw-typed">
          <small>Click the plan to add corners (snaps to 1/4" and right angles), or type each wall:</small>
          <div className="inline">
            <select value={dir} onChange={(e) => setDir(e.target.value as Dir)}>
              <option value="right">Right</option>
              <option value="up">Up</option>
              <option value="left">Left</option>
              <option value="down">Down</option>
            </select>
            <input type="number" min={1} value={len} onChange={(e) => setLen(Math.max(1, e.target.valueAsNumber || 1))} />
            <span>in</span>
            <button onClick={addTyped}>Add wall</button>
          </div>
        </div>
      )}
      <div className="shape-wrap" style={{ width: `min(100%, ${(480 * vb.w) / vb.h}px)`, aspectRatio: `${vb.w} / ${vb.h}` }}>
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${-(vb.y + vb.h)} ${vb.w} ${vb.h}`}
          className="plan shape-plan"
          role="img"
          aria-label="Floor outline"
          onClick={(e) => draft && addPoint(svgPoint(e))}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{ cursor: draft ? 'crosshair' : 'default', touchAction: 'none' }}
        >
          <polyline points={draft ? path : `${path} ${shown[0]?.x},${-(shown[0]?.y ?? 0)}`} fill={draft ? 'none' : '#f4ead2'} stroke="#222" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {!draft &&
            poly.map((a, i) => {
              const b = poly[(i + 1) % n]
              const isFront = i === front
              const horizontal = a.y === b.y
              return (
                <g key={i}>
                  <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} stroke={isFront ? '#e67e22' : '#555'} strokeWidth={isFront ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
                  <line
                    x1={a.x}
                    y1={-a.y}
                    x2={b.x}
                    y2={-b.y}
                    stroke="transparent"
                    strokeWidth={Math.max(10, pad * 0.9)}
                    style={{ cursor: horizontal ? 'ns-resize' : 'ew-resize', touchAction: 'none' }}
                    onPointerDown={(e) => startDrag(e, i)}
                  />
                </g>
              )
            })}
          {shown.map((p, i) => (
            <circle key={i} cx={p.x} cy={-p.y} r={Math.max(2, pad * 0.14)} fill={i === 0 ? '#c0392b' : '#222'} pointerEvents="none" />
          ))}
        </svg>
        {!draft &&
          poly.map((a, i) => {
            const b = poly[(i + 1) % n]
            const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
            return (
              <EdgeInput
                key={i}
                value={length}
                units={units}
                front={i === front}
                style={{ left: px((a.x + b.x) / 2), top: py((a.y + b.y) / 2) }}
                onCommit={(v) => commit(setEdgeLength(poly, i, v))}
              />
            )
          })}
      </div>
      {err && <div className="note failc">{err}</div>}
      {!draft && (
        <small>
          Drag a wall to push it in or out, or type its length right on it. Tap a wall to make it the <b style={{ color: '#e67e22' }}>FRONT</b> (drawers / entry; joists run away from it). Shapes are right-angled.
        </small>
      )}
    </div>
  )
}
