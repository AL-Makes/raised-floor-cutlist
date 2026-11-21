import { useState } from 'react'
import { floorPolygon, setEdgeLength, validatePolygon } from '../lib/geometry'
import type { FloorSpec, Pt } from '../lib/types'
import { formatLength, type UnitSystem } from '../lib/units'
import { LenInput } from './fields'

const DIRS = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] } as const
type Dir = keyof typeof DIRS

/** Draw / edit a right-angled floor outline and pick which edge is the front. */
export function ShapeEditor({ floor, units, onChange }: { floor: FloorSpec; units: UnitSystem; onChange: (f: FloorSpec) => void }) {
  const poly = floorPolygon(floor)
  const front = floor.frontEdge ?? 0
  const [draft, setDraft] = useState<Pt[] | null>(null)
  const [dir, setDir] = useState<Dir>('right')
  const [len, setLen] = useState(36)

  const shown = draft ?? poly
  const err = draft ? undefined : validatePolygon(poly)
  const xs = shown.map((p) => p.x)
  const ys = shown.map((p) => p.y)
  const minX = Math.min(0, ...xs)
  const minY = Math.min(0, ...ys)
  const maxX = Math.max(120, ...xs)
  const maxY = Math.max(96, ...ys)
  const pad = 12
  const vb = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 }

  const commit = (pts: Pt[]) => onChange({ ...floor, shape: 'poly', poly: pts, frontEdge: Math.min(front, pts.length - 1) })

  const addPoint = (pt: Pt) => {
    const d = draft ?? []
    const last = d[d.length - 1]
    let q = { x: Math.round(pt.x), y: Math.round(pt.y) }
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
  const svgPoint = (e: React.MouseEvent<SVGSVGElement>): Pt => {
    const svg = e.currentTarget
    const r = svg.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    return { x: vb.x + fx * vb.w, y: vb.y + vb.h - fy * vb.h }
  }

  const path = shown.map((p) => `${p.x},${-p.y}`).join(' ')
  const n = shown.length

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
          <small>Click the plan to add corners (snaps to 1" and right angles), or type each wall:</small>
          <div className="inline">
            <select value={dir} onChange={(e) => setDir(e.target.value as Dir)}>
              <option value="right">Right →</option>
              <option value="up">Up ↑</option>
              <option value="left">Left ←</option>
              <option value="down">Down ↓</option>
            </select>
            <input type="number" min={1} value={len} onChange={(e) => setLen(Math.max(1, e.target.valueAsNumber || 1))} />
            <span>in</span>
            <button onClick={addTyped}>Add wall</button>
          </div>
        </div>
      )}
      <svg
        viewBox={`${vb.x} ${-(vb.y + vb.h)} ${vb.w} ${vb.h}`}
        className="plan shape-plan"
        role="img"
        aria-label="Floor outline"
        onClick={(e) => draft && addPoint(svgPoint(e))}
        style={{ cursor: draft ? 'crosshair' : 'default' }}
      >
        <polyline points={draft ? path : `${path} ${shown[0]?.x},${-(shown[0]?.y ?? 0)}`} fill={draft ? 'none' : '#f4ead2'} stroke="#222" strokeWidth={1} />
        {!draft &&
          poly.map((a, i) => {
            const b = poly[(i + 1) % n]
            const isFront = i === front
            return (
              <g key={i} onClick={() => onChange({ ...floor, shape: floor.shape, frontEdge: i })} style={{ cursor: 'pointer' }}>
                <line x1={a.x} y1={-a.y} x2={b.x} y2={-b.y} stroke={isFront ? '#e67e22' : 'transparent'} strokeWidth={isFront ? 3 : 8} />
                <text x={(a.x + b.x) / 2} y={-(a.y + b.y) / 2} fontSize={6} textAnchor="middle" fill={isFront ? '#e67e22' : '#555'} dy={-2}>
                  {isFront ? 'FRONT' : i + 1}
                </text>
              </g>
            )
          })}
        {shown.map((p, i) => (
          <circle key={i} cx={p.x} cy={-p.y} r={2} fill={i === 0 ? '#c0392b' : '#222'} />
        ))}
      </svg>
      {err && <div className="note failc">{err}</div>}
      {!draft && (
        <>
          <small>Tap an edge on the plan (or its number below) to make it the FRONT: the side with drawers / entry. Joists run away from it.</small>
          <div className="edge-table">
            {poly.map((a, i) => {
              const b = poly[(i + 1) % n]
              const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
              return (
                <div key={i} className={`edge-row ${i === front ? 'front' : ''}`}>
                  <button onClick={() => onChange({ ...floor, frontEdge: i })} title="Make this the front">
                    {i === front ? 'FRONT' : `Edge ${i + 1}`}
                  </button>
                  {floor.shape === 'poly' ? (
                    <LenInput label="Length" units={units} value={length} min={1} onChange={(v) => commit(setEdgeLength(poly, i, v))} />
                  ) : (
                    <span>{formatLength(length, units)}</span>
                  )}
                </div>
              )
            })}
          </div>
          {floor.shape !== 'poly' && <small>Choose "Polygon" to edit each wall length.</small>}
        </>
      )}
    </div>
  )
}
