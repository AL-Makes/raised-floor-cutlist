import type { Build } from '../lib/build'
import type { Structural } from '../lib/structural'
import { matSchedule, type TatamiArrangement } from '../lib/tatami'
import { formatLength, type UnitSystem } from '../lib/units'

export function CutListTab({ build, mats, units }: { build: Build; mats: TatamiArrangement['mats']; units: UnitSystem }) {
  const f = (v: number) => formatLength(v, units)
  const groups = [...new Set(build.parts.map((p) => p.group))]
  const sched = matSchedule(mats)
  return (
    <div className="tab">
      <h3>Cut list</h3>
      <div className="stats">
        <div><b>{build.deckPanels}</b><span>plywood deck panel(s) - fewest pieces, each lifts alone</span></div>
        <div><b>{Math.round(build.heaviestPanelLb)} lb</b><span>heaviest panel</span></div>
        <div><b>{build.jointCount.joists} / {build.jointCount.crossJoists}</b><span>joists / cross-joist rows</span></div>
      </div>
      {groups.map((g) => (
        <div key={g} className="tablewrap">
          <h4>{g}</h4>
          <table>
            <thead>
              <tr><th>#</th><th>Part</th><th>Material</th><th>Qty</th><th>Length</th><th>Width</th><th>Thick</th><th>Pockets</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {build.parts.filter((p) => p.group === g).map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td><td>{p.name}</td><td>{p.material}</td><td><b>{p.qty}</b></td>
                  <td>{f(p.length)}</td><td>{f(p.width)}</td><td>{f(p.thickness)}</td><td>{p.pockets || ''}</td><td>{p.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <h3>What to buy (optimized cutting)</h3>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Material</th><th>Qty</th><th>Size</th><th>Waste</th></tr></thead>
          <tbody>
            {build.lumberPlans.map((l) => (
              <tr key={l.material}><td>{l.material} lumber</td><td><b>{l.boards.length}</b></td><td>{f(l.stockLength)} boards</td><td>{l.wastePct.toFixed(0)}%</td></tr>
            ))}
            {build.sheetPlans.map((s) => (
              <tr key={s.material}><td>{s.material} plywood</td><td><b>{s.sheets.length}</b></td><td>{f(build.params.sheetL)} x {f(build.params.sheetW)} sheets</td><td>{s.wastePct.toFixed(0)}%</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {build.lumberPlans.map((l) => (
        <details key={l.material}>
          <summary>{l.material} cutting plan ({l.boards.length} x {f(l.stockLength)})</summary>
          <ol>
            {l.boards.map((b, i) => (
              <li key={i}>{b.cuts.map((c) => f(c)).join(' + ')} <small>(offcut {f(l.stockLength - b.used)})</small></li>
            ))}
          </ol>
        </details>
      ))}
      {build.sheetPlans.map((s) => (
        <details key={s.material}>
          <summary>{s.material} sheet layouts ({s.sheets.length})</summary>
          <ol>
            {s.sheets.map((sh, i) => (
              <li key={i}>{sh.pieces.map((p) => `${f(p.w)} x ${f(p.h)}`).join(', ')}</li>
            ))}
          </ol>
        </details>
      ))}

      <h3>Hardware & consumables</h3>
      <ul>
        {build.hardware.map((h) => (
          <li key={h.name}><b>{h.qty} {h.unit}</b> - {h.name} {h.notes && <small>({h.notes})</small>}</li>
        ))}
      </ul>

      <h3>Tatami mats</h3>
      <ul>
        {sched.map((m) => (
          <li key={`${m.name}${m.w}${m.l}`}><b>{m.qty}</b> x {m.name} {f(m.w)} x {f(m.l)}</li>
        ))}
      </ul>

      <h3>Assembly order (pocket-screw joinery)</h3>
      <ol>{build.assembly.map((s, i) => <li key={i}>{s}</li>)}</ol>
    </div>
  )
}

export function LoadTab({ s, build, apply }: { s: Structural; build: Build; apply: (id: string) => void }) {
  const p = build.params
  return (
    <div className="tab">
      <h3>Load capacity (estimate)</h3>
      <div className="stats">
        <div><b>{Math.round(s.minPsf)} psf</b><span>weakest deck / hatch span (L/360)</span></div>
        <div><b>{Math.round(s.minPointLb)} lb</b><span>weakest point load</span></div>
        <div><b>{p.designLoadPsf} psf / {p.pointLoadLb} lb</b><span>your design targets</span></div>
        {s.joistPsf !== undefined && <div><b>{Math.round(s.joistPsf)} psf</b><span>joists between shims</span></div>}
      </div>
      <p className="legend"><i className="dot ok" /> OK (1.5x margin) <i className="dot warn" /> marginal <i className="dot fail" /> weak. Turn on "Load map" in the 3D view to see it.</p>
      <h3>Weak points</h3>
      {s.issues.length === 0 && <p>No weak points found for these inputs.</p>}
      <ul>
        {s.issues.map((i, k) => (
          <li key={k} className={`issue ${i.severity}`}>{i.text}</li>
        ))}
      </ul>
      <h3>Ways to reinforce</h3>
      {s.suggestions.length === 0 && <p>Nothing to change.</p>}
      <ul>
        {s.suggestions.map((x) => (
          <li key={x.id}>
            {x.text} {x.apply && <button className="small" onClick={() => apply(x.id)}>Apply</button>}
          </li>
        ))}
      </ul>
      <p className="disclaimer">Estimates only (SPF No.2 lumber, structural plywood, simple spans). This is not engineered design - confirm with a professional and your condo board / local code before building.</p>
    </div>
  )
}
