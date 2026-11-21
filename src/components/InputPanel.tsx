import { CUSTOM_BIN_ID, CUSTOM_ROLLING_ID, IKEA_BINS, IKEA_ROLLING_BOXES, findBin, findRollingBox } from '../lib/bins'
import type { Build } from '../lib/build'
import type { Params } from '../lib/types'
import { formatLength, type UnitSystem } from '../lib/units'
import { Check, LenInput } from './fields'
import { ShapeEditor } from './ShapeEditor'
import { floorPolygon } from '../lib/geometry'

function Stepper({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="stepper">
        <button onClick={() => onChange(value - 1)}>-</button>
        <b>{value > 0 ? `+${value}` : value}</b>
        <button onClick={() => onChange(value + 1)}>+</button>
      </div>
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function InputPanel({ p, set, units, build }: { p: Params; set: (f: (p: Params) => Params) => void; units: UnitSystem; build: Build }) {
  const upd = (patch: Partial<Params>) => set((q) => ({ ...q, ...patch }))
  const bin = findBin(p.binId)
  const rolling = findRollingBox(p.rollingBox.id)
  const h = build.height
  return (
    <div className="inputs">
      <section>
        <h3>1. Floor shape</h3>
        <div className="seg">
          <button className={p.floor.shape === 'rect' ? 'on' : ''} onClick={() => upd({ floor: { ...p.floor, shape: 'rect', frontEdge: 0 } })}>Rectangle</button>
          <button className={p.floor.shape === 'L' ? 'on' : ''} onClick={() => upd({ floor: { ...p.floor, shape: 'L', frontEdge: 0 } })}>L-shape</button>
          <button className={p.floor.shape === 'poly' ? 'on' : ''} onClick={() => upd({ floor: { ...p.floor, shape: 'poly', poly: p.floor.shape === 'poly' ? p.floor.poly : floorPolygon(p.floor) } })}>Polygon</button>
        </div>
        {p.floor.shape !== 'poly' && (
          <div className="grid2">
            <LenInput label="Width" units={units} value={p.floor.width} min={12} onChange={(v) => upd({ floor: { ...p.floor, width: v } })} />
            <LenInput label="Length" units={units} value={p.floor.length} min={12} onChange={(v) => upd({ floor: { ...p.floor, length: v } })} />
            {p.floor.shape === 'L' && (
              <>
                <LenInput label="Notch width (back-right)" units={units} value={p.floor.notchW} min={1} onChange={(v) => upd({ floor: { ...p.floor, notchW: v } })} />
                <LenInput label="Notch length" units={units} value={p.floor.notchL} min={1} onChange={(v) => upd({ floor: { ...p.floor, notchL: v } })} />
              </>
            )}
          </div>
        )}
        <div className="shape-row">
          <div className="shape-main">
            <ShapeEditor floor={p.floor} units={units} onChange={(f) => upd({ floor: f })} />
          </div>
          <div className="height-ctl">
            <span>Height</span>
            <input
              className="vslider"
              type="range"
              min={4}
              max={36}
              step={0.25}
              value={Math.min(36, Math.max(4, p.finalHeight))}
              onChange={(e) => upd({ finalHeight: e.target.valueAsNumber, heightOption: 0 })}
              aria-label="Final height"
            />
            <LenInput label="" units={units} value={p.finalHeight} min={2} onChange={(v) => upd({ finalHeight: v, heightOption: 0 })} />
          </div>
        </div>
        <small>Tip: type 38 1/2 or 3' 2 for inches. Shapes are right-angled (all walls square to each other), built as joined rectangles.</small>
      </section>

      <section>
        <h3>2. Storage bin</h3>
        <label className="field">
          <span>IKEA bin</span>
          <select value={p.binId} onChange={(e) => {
            const id = e.target.value
            const b = findBin(id)
            upd(b ? { binId: id, bin: { w: b.w, d: b.d, h: b.h } } : { binId: id })
          }}>
            {IKEA_BINS.map((b) => (
              <option key={b.id} value={b.id}>{b.name} - {formatLength(b.w, units)} x {formatLength(b.d, units)} x {formatLength(b.h, units)}</option>
            ))}
            <option value={CUSTOM_BIN_ID}>Custom size...</option>
          </select>
        </label>
        {bin && (
          <small>
            <a href={bin.url} target="_blank" rel="noreferrer">Open {bin.series} on ikea.com</a> to confirm the exact size. Built-in sizes are approximate.
          </small>
        )}
        <div className="grid2">
          <LenInput label="Bin width" units={units} value={p.bin.w} min={1} onChange={(v) => upd({ binId: CUSTOM_BIN_ID, bin: { ...p.bin, w: v } })} />
          <LenInput label="Bin depth" units={units} value={p.bin.d} min={1} onChange={(v) => upd({ binId: CUSTOM_BIN_ID, bin: { ...p.bin, d: v } })} />
          <LenInput label="Bin height" units={units} value={p.bin.h} min={1} onChange={(v) => upd({ binId: CUSTOM_BIN_ID, bin: { ...p.bin, h: v } })} />
          <LenInput label="Clearance around bin" units={units} value={p.clearance} onChange={(v) => upd({ clearance: v })} />
        </div>
        <Check label="Bin's long side runs along the joists" checked={p.binLongAlongJoists} onChange={(v) => upd({ binLongAlongJoists: v })} hint="Off = long side across the joists" />
      </section>

      <section>
        <h3>3. Height & layers</h3>
        <LenInput label="Final height (slab to top of tatami)" units={units} value={p.finalHeight} min={2} onChange={(v) => upd({ finalHeight: v, heightOption: 0 })} />
        <div className="grid2">
          <LenInput label="Plywood thickness" units={units} value={p.plyThickness} min={0.25} onChange={(v) => upd({ plyThickness: v, heightOption: 0 })} />
          <LenInput label="Tatami thickness" units={units} value={p.tatamiThickness} onChange={(v) => upd({ tatamiThickness: v, heightOption: 0 })} />
        </div>
        <div className={`note ${h.fits ? 'okc' : 'failc'}`}>
          Frame height needed: <b>{formatLength(h.target, units)}</b> (bins need {formatLength(h.required, units)}).
          {!h.fits && <> Raise the final height to at least <b>{formatLength(h.minFinalHeight, units)}</b>.</>}
        </div>
        <div className="seg">
          <button className={p.joistStyle === 'builtup' ? 'on' : ''} onClick={() => upd({ joistStyle: 'builtup', heightOption: 0 })}>Built-up joists (2x4 top + bottom, 2x4 webs)</button>
          <button className={p.joistStyle === 'solid' ? 'on' : ''} onClick={() => upd({ joistStyle: 'solid', heightOption: 0 })}>Solid boards on edge</button>
        </div>
        {h.options.length > 0 && (
          <label className="field">
            <span>How to build that height</span>
            <select value={Math.min(p.heightOption, h.options.length - 1)} onChange={(e) => upd({ heightOption: Number(e.target.value) })}>
              {h.options.map((o, i) => (
                <option key={o.id} value={i}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section>
        <h3>4. Features</h3>
        <Check label="Drawers on the front row" checked={p.features.drawers} onChange={(v) => upd({ features: { ...p.features, drawers: v }, heightOption: 0 })} hint="Slide-out or rolling drawers along the front; needs more height" />
        {p.features.drawers && (
          <div className="subopts">
            <div className="seg">
              <button className={p.drawerKind === 'built' ? 'on' : ''} onClick={() => upd({ drawerKind: 'built', heightOption: 0 })}>Build drawers (bin inside)</button>
              <button className={p.drawerKind === 'ikea' ? 'on' : ''} onClick={() => upd({ drawerKind: 'ikea', heightOption: 0 })}>Ready-made IKEA rolling box</button>
            </div>
            {p.drawerKind === 'ikea' && (
              <>
                <label className="field">
                  <span>Rolling drawer / box</span>
                  <select value={p.rollingBox.id} onChange={(e) => {
                    const id = e.target.value
                    const b = findRollingBox(id)
                    upd(b ? { rollingBox: { id, w: b.w, d: b.d, h: b.h }, heightOption: 0 } : { rollingBox: { ...p.rollingBox, id: CUSTOM_ROLLING_ID } })
                  }}>
                    {IKEA_ROLLING_BOXES.map((b) => (
                      <option key={b.id} value={b.id}>{b.name} - {formatLength(b.w, units)} x {formatLength(b.d, units)} x {formatLength(b.h, units)}</option>
                    ))}
                    <option value={CUSTOM_ROLLING_ID}>Custom size...</option>
                  </select>
                </label>
                {rolling && (
                  <small>
                    <a href={rolling.url} target="_blank" rel="noreferrer">Open on ikea.com</a> to confirm the size{rolling.casters ? '' : '; this one has no wheels, so add casters (height included below)'}. Joist spacing follows the box width + clearance.
                  </small>
                )}
                <div className="grid2">
                  <LenInput label="Box width" units={units} value={p.rollingBox.w} min={1} onChange={(v) => upd({ rollingBox: { ...p.rollingBox, id: CUSTOM_ROLLING_ID, w: v }, heightOption: 0 })} />
                  <LenInput label="Box depth" units={units} value={p.rollingBox.d} min={1} onChange={(v) => upd({ rollingBox: { ...p.rollingBox, id: CUSTOM_ROLLING_ID, d: v }, heightOption: 0 })} />
                  <LenInput label="Height incl. wheels" units={units} value={p.rollingBox.h} min={1} onChange={(v) => upd({ rollingBox: { ...p.rollingBox, id: CUSTOM_ROLLING_ID, h: v }, heightOption: 0 })} />
                </div>
                <small>The box's short side goes across the joists; its long side pulls out toward the front.</small>
              </>
            )}
          </div>
        )}
        <Check label="Access hatches over bins" checked={p.features.hatches} onChange={(v) => upd({ features: { ...p.features, hatches: v } })} />
        <Check label="Fascia edge trim" checked={p.features.edgeTrim} onChange={(v) => upd({ features: { ...p.features, edgeTrim: v } })} />
        {p.features.edgeTrim && (
          <div className="inline">
            {(['front', 'back', 'left', 'right'] as const).map((s) => (
              <Check key={s} label={s} checked={p.trimSides[s]} onChange={(v) => upd({ trimSides: { ...p.trimSides, [s]: v } })} />
            ))}
          </div>
        )}
        <Check label="Acoustic isolation strips under joists" checked={p.features.acousticStrips} onChange={(v) => upd({ features: { ...p.features, acousticStrips: v } })} />
        <Check label="Double the interior joists" checked={p.reinforce.doubleJoists} onChange={(v) => upd({ reinforce: { doubleJoists: v } })} hint="Reinforcement; narrows nothing, adds strength" />
      </section>

      <section>
        <h3>5. Stock & loads</h3>
        <div className="grid2">
          <LenInput label="Sheet length" units={units} value={p.sheetL} min={12} onChange={(v) => upd({ sheetL: v })} />
          <LenInput label="Sheet width" units={units} value={p.sheetW} min={12} onChange={(v) => upd({ sheetW: v })} />
          <LenInput label="Saw kerf" units={units} value={p.kerf} onChange={(v) => upd({ kerf: v })} />
          <LenInput label="Max joist spacing (o.c.)" units={units} value={p.maxSpacing} onChange={(v) => upd({ maxSpacing: v })} />
          <Stepper label="Main joists" value={p.joistAdjust} onChange={(v) => upd({ joistAdjust: v })} hint={`${build.layout.cellMinX ? `Spacing = bin width + clearance (${formatLength(build.layout.cellMinX, units)} clear)` : ''}. + adds, - removes (wider cells hold 2+ bins)`} />
          <Stepper label="Cross joists (per section)" value={p.crossAdjust} onChange={(v) => upd({ crossAdjust: v })} hint="Relative to the automatic count" />
          <label className="field">
            <span>Supports per joist <em>0 = continuous</em></span>
            <div className="stepper">
              <button onClick={() => upd({ supportCount: p.supportCount <= 2 ? 0 : p.supportCount - 1 })}>-</button>
              <b>{p.supportCount < 2 ? 'cont.' : p.supportCount}</b>
              <button onClick={() => upd({ supportCount: p.supportCount < 2 ? 2 : p.supportCount + 1 })}>+</button>
            </div>
          </label>
          <label className="field">
            <span>Design load <em>psf</em></span>
            <input type="number" value={p.designLoadPsf} min={1} onChange={(e) => e.target.valueAsNumber > 0 && upd({ designLoadPsf: e.target.valueAsNumber })} />
          </label>
          <label className="field">
            <span>Point load <em>lb</em></span>
            <input type="number" value={p.pointLoadLb} min={1} onChange={(e) => e.target.valueAsNumber > 0 && upd({ pointLoadLb: e.target.valueAsNumber })} />
          </label>
        </div>
        <label className="field">
          <span>Lumber stock lengths available (feet, comma separated)</span>
          <input
            defaultValue={p.lumberLengths.map((l) => l / 12).join(', ')}
            onBlur={(e) => {
              const v = e.target.value.split(/[,\s]+/).map((s) => parseFloat(s) * 12).filter((n) => n > 0)
              if (v.length) upd({ lumberLengths: v })
            }}
          />
        </label>
      </section>
    </div>
  )
}
