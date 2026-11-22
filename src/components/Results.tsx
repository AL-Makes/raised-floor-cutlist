import { buildFloor, type Build } from '../lib/build'
import { estimateCost } from '../lib/cost'
import { crowdScenario, maxWebOc, SCENARIO, type Structural } from '../lib/structural'
import { matSchedule, type TatamiArrangement } from '../lib/tatami'
import { estimateWeight } from '../lib/weight'
import { formatLength, type UnitSystem } from '../lib/units'

const money = (v: number) => `$${v.toFixed(2)}`

export function CutListTab({ build, mats, units, onPrice }: { build: Build; mats: TatamiArrangement['mats']; units: UnitSystem; onPrice?: (key: string, val: number | undefined) => void }) {
  const f = (v: number) => formatLength(v, units)
  const groups = [...new Set(build.parts.map((p) => p.group))]
  const sched = matSchedule(mats)
  const cost = estimateCost(build, mats, units)
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
      {sched.some((m) => m.name.startsWith('Plywood filler')) && (
        <p className="legend">
          Where the mat pattern does not reach, cut plywood filler pieces (laminate plywood to {f(build.params.tatamiThickness)} to match the mat height) and screw them down to the joists below. They are fixed in place, so the bins under them are not accessible.
        </p>
      )}

      <h3>Assembly order (pocket-screw joinery)</h3>
      <ol>{build.assembly.map((s, i) => <li key={i}>{s}</li>)}</ol>

      <h3>Financial report (estimated build cost)</h3>
      <div className="stats">
        <div><b>{money(cost.total)}</b><span>estimated total build price</span></div>
        {cost.groups.map((g) => (
          <div key={g.group}><b>{money(g.subtotal)}</b><span>{g.group}</span></div>
        ))}
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Group</th><th>Item</th><th>Qty</th><th>Unit</th><th>Unit price ($)</th><th>Subtotal</th></tr>
          </thead>
          <tbody>
            {cost.groups.flatMap((g) =>
              g.items.map((it, idx) => (
                <tr key={it.key}>
                  <td>{idx === 0 ? <b>{g.group}</b> : ''}</td>
                  <td>{it.label}{it.notes && <> <small>({it.notes})</small></>}</td>
                  <td><b>{it.qty}</b></td>
                  <td>{it.unit}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      style={{ width: '5.5rem' }}
                      aria-label={`Price for ${it.label}`}
                      value={build.params.prices?.[it.key] ?? it.unitPrice}
                      onChange={(e) => {
                        const raw = e.target.value
                        const num = raw === '' ? 0 : Number(raw)
                        if (onPrice && Number.isFinite(num) && num >= 0) onPrice(it.key, num)
                      }}
                    />
                  </td>
                  <td><b>{money(it.total)}</b></td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CostTab({ build, mats, units, onPrice, onResetPrices }: { build: Build; mats: TatamiArrangement['mats']; units: UnitSystem; onPrice: (key: string, val: number | undefined) => void; onResetPrices: () => void }) {
  const cost = estimateCost(build, mats, units)
  const hasCustom = Object.keys(build.params.prices ?? {}).length > 0
  return (
    <div className="tab">
      <h3>Financial report & build cost estimator</h3>
      <div className="stats">
        <div><b>{money(cost.total)}</b><span>estimated total build price</span></div>
        {cost.groups.map((g) => (
          <div key={g.group}><b>{money(g.subtotal)}</b><span>{g.group}</span></div>
        ))}
      </div>
      <p className="legend">
        Enter your local unit prices below (e.g. 8 ft 2x4 lumber, plywood sheets, tatami mats, motorized lift table column, bins, or hardware). Group subtotals and the estimated build price update automatically.
        {hasCustom && (
          <> <button className="small" onClick={onResetPrices}>Reset default prices</button></>
        )}
      </p>
      {cost.groups.map((g) => (
        <div key={g.group} className="tablewrap">
          <h4>{g.group} — {money(g.subtotal)}</h4>
          <table>
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit price ($)</th><th>Total</th></tr>
            </thead>
            <tbody>
              {g.items.map((it) => (
                <tr key={it.key}>
                  <td>{it.label}{it.notes && <> <small>({it.notes})</small></>}</td>
                  <td><b>{it.qty}</b></td>
                  <td>{it.unit}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      style={{ width: '6rem' }}
                      aria-label={`Unit price for ${it.label}`}
                      value={build.params.prices?.[it.key] ?? it.unitPrice}
                      onChange={(e) => {
                        const raw = e.target.value
                        const num = raw === '' ? 0 : Number(raw)
                        if (Number.isFinite(num) && num >= 0) onPrice(it.key, num)
                      }}
                    />
                  </td>
                  <td><b>{money(it.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

export function LoadTab({ s, build, apply, mats, units, onWebOc, onPeople }: { onPeople: (n: number) => void; s: Structural; build: Build; apply: (id: string) => void; onWebOc: (n: number) => void; mats: TatamiArrangement['mats']; units: UnitSystem }) {
  const p = build.params
  const w = estimateWeight(build, mats)
  const builtup = p.joistStyle === 'builtup'
  const recWeb = maxWebOc(build)
  const curWeb = p.webOc > 0 ? p.webOc : 16
  const recWeight = builtup && recWeb !== curWeb ? estimateWeight(buildFloor({ ...p, webOc: recWeb }), mats).total : w.total
  const cs = crowdScenario(build)
  const wt = (lb: number) => (units === 'metric' ? `${Math.round(lb * 0.45359)} kg` : `${Math.round(lb)} lb`)
  return (
    <div className="tab">
      <h3>Structure weight (estimate)</h3>
      <div className="stats"><div><b>{wt(w.total)}</b><span>total dead weight</span></div></div>
      <ul>{w.rows.map((r) => <li key={r.label}><b>{wt(r.lb)}</b> - {r.label} {r.note && <small>({r.note})</small>}</li>)}</ul>
      <p className="legend">Counts framing, plywood, drawer boxes, trim, tatami and table assemblies. Does not count bins, anything stored in them, the TV or TV stand.</p>
      {builtup && (
        <>
          <h3>Vertical web optimizer</h3>
          <p>
            Design case: TV ({SCENARIO.tvLb} lb) + TV stand ({SCENARIO.standLb} lb) always, plus 1 person ({SCENARIO.personLb} lb) per {SCENARIO.sqftPerPerson} sq ft of floor ({Math.round(cs.area)} sq ft = {cs.auto} people).
          </p>
          <p>
            Designed for <b>{cs.people} people</b>{p.peopleAdj !== 0 && <> ({p.peopleAdj > 0 ? '+' : ''}{p.peopleAdj})</>}: <button className="small" onClick={() => onPeople(p.peopleAdj - 1)} disabled={cs.people <= 0}>- person</button> <button className="small" onClick={() => onPeople(p.peopleAdj + 1)}>+ person</button> = <b>{Math.round(cs.lb)} lb</b>, about {Math.round(cs.psf)} psf spread over the whole floor (design target {p.designLoadPsf} psf, {p.pointLoadLb} lb point load).
          </p>
          <p>
            Webs are now <b>{curWeb}"</b> apart. Most spacing the plywood-bearing 2x4 chord allows: <b>{recWeb}"</b>.
            {recWeb !== curWeb && <> Going to {recWeb}" changes the structure weight from {wt(w.total)} to {wt(recWeight)}. </>}
            {recWeb > curWeb && <button className="small" onClick={() => onWebOc(recWeb)}>Apply {recWeb}" spacing</button>}
            {recWeb < curWeb && <button className="small" onClick={() => onWebOc(recWeb)}>Tighten to {recWeb}"</button>}
            {recWeb === curWeb && <>Already at the optimum.</>}
          </p>
        </>
      )}
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
