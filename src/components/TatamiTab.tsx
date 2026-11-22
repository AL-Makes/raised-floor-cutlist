import type { Build } from '../lib/build'
import { TATAMI_FIT_MESSAGE, type TatamiAnchor, type TatamiArrangement } from '../lib/tatami'
import { formatLength, type UnitSystem } from '../lib/units'

const ANCHORS: { id: TatamiAnchor; label: string }[] = [
  { id: 'bl', label: 'Front-left' },
  { id: 'br', label: 'Front-right' },
]

const FILL = { full: '#b7c78a', square: '#a9cf9a', cut: '#c9a66b' }

export function TatamiTab({ build, options, selected, onSelect, units, lifts, onToggleLift, anchor, onAnchor }: { build: Build; options: TatamiArrangement[]; selected: string; onSelect: (id: string) => void; units: UnitSystem; lifts: { x: number; y: number }[]; onToggleLift: (x: number, y: number) => void; anchor: TatamiAnchor; onAnchor: (a: TatamiAnchor) => void }) {
  const f = build.geometry
  const cur = options.find((o) => o.id === selected) ?? options[0]
  const pad = 6
  if (!build.tatamiFits) return <div className="tab"><p className="warnings">{TATAMI_FIT_MESSAGE}</p></div>
  if (!cur) return <div className="tab">Enter a valid floor shape to see tatami layouts.</div>
  return (
    <div className="tab">
      <h3>Tatami layout suggestions</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' }}>
        <span className="legend">Start layout from:</span>
        <div className="seg" role="group" aria-label="Layout starts from" style={{ flexWrap: 'wrap' }}>
          {ANCHORS.map((a) => (
            <button key={a.id} className={anchor === a.id ? 'on' : ''} onClick={() => onAnchor(a.id)}>{a.label}</button>
          ))}
        </div>
      </div>
      <div className="cards">
        {options.map((o, i) => (
          <button key={o.id} className={`card ${o.id === cur.id ? 'on' : ''}`} onClick={() => onSelect(o.id)}>
            <b>{o.label}</b> {i === 0 && <span className="badge">Best fit</span>}
            <small>{o.description}</small>
            <small>
              {o.counts.full} full, {o.counts.square} square, {o.counts.cut} plywood filler - {o.auspicious ? 'auspicious (shugi-jiki, T-joints only)' : `${o.fourCorner} four-corner joint${o.fourCorner === 1 ? '' : 's'} (grid, fushugi-jiki)`}
            </small>
          </button>
        ))}
      </div>
      <svg viewBox={`${-pad} ${-pad} ${f.width + pad * 2} ${f.length + pad * 2}`} className="plan" role="img" aria-label="Tatami plan">
        <g transform={`translate(0 ${f.length}) scale(1 -1)`}>
          {cur.mats.map((m, i) => {
            const square = Math.abs(m.w - build.params.tatamiShort) < 0.01 && Math.abs(m.l - build.params.tatamiShort) < 0.01
            const lift = square && lifts.some((l) => Math.abs(l.x - m.x) < 0.01 && Math.abs(l.y - m.y) < 0.01)
            return (
              <g key={i} onClick={square ? () => onToggleLift(m.x, m.y) : undefined} style={square ? { cursor: 'pointer' } : undefined}>
                <rect x={m.x} y={m.y} width={m.w} height={m.l} fill={lift ? '#e67e22' : FILL[m.kind]} stroke="#5a5a3a" strokeWidth={0.5} />
                {lift && <path d={`M${m.x + 6} ${m.y + 6}L${m.x + m.w - 6} ${m.y + m.l - 6}M${m.x + 6} ${m.y + m.l - 6}L${m.x + m.w - 6} ${m.y + 6}`} stroke="#fff" strokeWidth={1.5} />}
              </g>
            )
          })}
          {build.layout.cells.map((c) => (
            <rect key={`c${c.index}`} x={c.x} y={c.y} width={c.w} height={c.l} fill="none" stroke={c.type === 'drawer' ? '#2c6fb3' : '#c0392b'} strokeWidth={0.4} strokeDasharray="2 1.5" />
          ))}
          <polygon points={f.poly.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#222" strokeWidth={1} />
        </g>
      </svg>
      <p className="legend">
        <b>Motorized lift tables:</b> tap a square mat ({formatLength(build.params.tatamiShort, units)} x {formatLength(build.params.tatamiShort, units)}) to replace it with an electric raise/lower table (orange X); tap again to undo.
        {lifts.length > 0 && ` ${lifts.length} selected - the frame, deck, bins and drawers are adjusted around them.`}
      </p>
      <p className="legend">
        Dashed outlines = bin cells under the mats (red) / drawers (blue). Plywood filler pieces (tan) cover the leftover area where mats do not reach ({cur.cutAreaPct.toFixed(1)}% of the floor); they are screwed down to the joists and are not accessible.
        {' '}Mat sizes: {formatLength(build.params.tatamiLong, units)} x {formatLength(build.params.tatamiShort, units)}.
      </p>
    </div>
  )
}
