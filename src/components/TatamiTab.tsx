import type { Build } from '../lib/build'
import type { TatamiArrangement } from '../lib/tatami'
import { formatLength, type UnitSystem } from '../lib/units'

const FILL = { full: '#b7c78a', square: '#a9cf9a', cut: '#e6c97a' }

export function TatamiTab({ build, options, selected, onSelect, units }: { build: Build; options: TatamiArrangement[]; selected: string; onSelect: (id: string) => void; units: UnitSystem }) {
  const f = build.params.floor
  const cur = options.find((o) => o.id === selected) ?? options[0]
  const pad = 6
  if (!cur) return <div className="tab">Enter a floor size to see tatami layouts.</div>
  return (
    <div className="tab">
      <h3>Tatami layout suggestions</h3>
      <div className="cards">
        {options.map((o, i) => (
          <button key={o.id} className={`card ${o.id === cur.id ? 'on' : ''}`} onClick={() => onSelect(o.id)}>
            <b>{o.label}</b> {i === 0 && <span className="badge">Best fit</span>}
            <small>{o.description}</small>
            <small>
              {o.counts.full} full, {o.counts.square} square, {o.counts.cut} cut - {o.fourCorner} four-corner joint{o.fourCorner === 1 ? '' : 's'}
            </small>
          </button>
        ))}
      </div>
      <svg viewBox={`${-pad} ${-pad} ${f.width + pad * 2} ${f.length + pad * 2}`} className="plan" role="img" aria-label="Tatami plan">
        <g transform={`translate(0 ${f.length}) scale(1 -1)`}>
          {cur.mats.map((m, i) => (
            <rect key={i} x={m.x} y={m.y} width={m.w} height={m.l} fill={FILL[m.kind]} stroke="#5a5a3a" strokeWidth={0.5} />
          ))}
          {build.layout.cells.map((c) => (
            <rect key={`c${c.index}`} x={c.x} y={c.y} width={c.w} height={c.l} fill="none" stroke={c.type === 'drawer' ? '#2c6fb3' : '#c0392b'} strokeWidth={0.4} strokeDasharray="2 1.5" />
          ))}
        </g>
      </svg>
      <p className="legend">
        Dashed outlines = bin cells under the mats (red) / drawers (blue). Cut mats (yellow) are
        {' '}{cur.cutAreaPct.toFixed(1)}% of the area. Mat sizes: {formatLength(build.params.tatamiLong, units)} x {formatLength(build.params.tatamiShort, units)}.
      </p>
    </div>
  )
}
