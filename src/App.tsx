import { useEffect, useMemo, useRef, useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { CostTab, CutListTab, LoadTab } from './components/Results'
import { TatamiTab } from './components/TatamiTab'
import { Viewer3D, LAYER_LABELS, FEATURE_KEYS, defaultView, type Layer, type LayerKey, type ViewOptions } from './components/Viewer3D'
import { buildFloor, defaultParams, type Build } from './lib/build'
import { toCsv } from './lib/export'
import { analyze } from './lib/structural'
import { suggestTatami } from './lib/tatami'
import { floorRects } from './lib/layout'
import { findBin } from './lib/bins'
import { DEMO_CAPTIONS, DEMO_MS, runDemo } from './demo'
import type { Params } from './lib/types'
import type { UnitSystem } from './lib/units'
import './App.css'

type Tab = '3d' | 'tatami' | 'cut' | 'cost' | 'load'

const STORE = 'raised-floor-cutlist:v1'
function loadSaved(): { params?: Partial<Params>; units?: UnitSystem; tab?: Tab; view?: Partial<ViewOptions> } {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export default function App() {
  const [demo, setDemo] = useState<number | null>(null)
  const demoRun = useRef<{ on: boolean } | null>(null)
  const [demoPulls, setDemoPulls] = useState<Record<string, number>>({})
  const demoSaved = useRef<{ params: Params; tab: Tab; view: ViewOptions } | null>(null)
  const [layersOpen, setLayersOpen] = useState(() => localStorage.getItem('raised-floor-cutlist:layersOpen') !== '0')
  useEffect(() => {
    try {
      localStorage.setItem('raised-floor-cutlist:layersOpen', layersOpen ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [layersOpen])
  const [saved] = useState(loadSaved)
  const [params, setParams] = useState<Params>(() => {
    const d = defaultParams()
    const anchor = saved.params?.tatamiAnchor === 'br' ? 'br' : 'bl'
    return { ...d, ...saved.params, tatamiAnchor: anchor, features: { ...d.features, ...saved.params?.features } }
  })
  const [units, setUnits] = useState<UnitSystem>(saved.units ?? 'imperial')
  const [tab, setTab] = useState<Tab>(saved.tab ?? '3d')
  const [view, setView] = useState<ViewOptions>(() => {
    const d = defaultView()
    const layers = { ...d.layers }
    for (const k of Object.keys(layers) as LayerKey[]) layers[k] = { ...layers[k], ...saved.view?.layers?.[k] }
    return { ...d, ...saved.view, layers }
  })
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ params, units, tab, view }))
    } catch {
      /* storage unavailable */
    }
  }, [params, units, tab, view])
  const setLayer = (k: LayerKey, patch: Partial<Layer>) =>
    setView((v) => ({ ...v, layers: { ...v.layers, [k]: { ...v.layers[k], ...patch } } }))
  const layerRow = (k: LayerKey) => (
    <div key={k} className="layerrow">
      <label>
        <input type="checkbox" checked={view.layers[k].visible} onChange={(e) => setLayer(k, { visible: e.target.checked })} />
        {LAYER_LABELS[k]}
      </label>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={view.layers[k].opacity}
        disabled={!view.layers[k].visible}
        title={`Opacity ${Math.round(view.layers[k].opacity * 100)}%`}
        onChange={(e) => setLayer(k, { opacity: Number(e.target.value) })}
      />
    </div>
  )

  const buildRef = useRef<Build | null>(null)
  const stopDemo = () => {
    if (demoRun.current) demoRun.current.on = false
    demoRun.current = null
    const s = demoSaved.current
    demoSaved.current = null
    if (s) {
      setParams(s.params)
      setTab(s.tab)
      setView(s.view)
    }
    setDemoPulls({})
    setDemo(null)
  }
  useEffect(() => () => { if (demoRun.current) demoRun.current.on = false }, [])
  const startDemo = () => {
    if (demo !== null) return
    demoSaved.current = { params, tab, view }
    const run = { on: true }
    demoRun.current = run
    const d = defaultParams()
    const b = findBin('samla-22')!
    const poly = [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 48 }, { x: 60, y: 48 }, { x: 60, y: 84 }, { x: 0, y: 84 }]
    setParams({ ...d, floor: { ...d.floor, shape: 'poly', poly, frontEdge: 0 }, binId: b.id, bin: { w: b.w, d: b.d, h: b.h }, finalHeight: 16 })
    const dv = defaultView()
    setView({ ...dv, dims: true, layers: { ...dv.layers, deck: { ...dv.layers.deck, visible: false }, tatami: { ...dv.layers.tatami, visible: false }, side: { ...dv.layers.side, visible: false } } })
    setTab('3d')
    setLayersOpen(true)
    setDemo(0)
    window.setTimeout(() => {
      if (!run.on) return
      void runDemo({
        alive: () => run.on,
        caption: (i) => setDemo(i),
        build: () => buildRef.current!,
        setPulls: setDemoPulls,
      }).then(() => { if (run.on) stopDemo() })
    }, 500)
  }

  const build = useMemo(() => buildFloor(params), [params])
  buildRef.current = build
  const structural = useMemo(() => analyze(build), [build])

  // the final-height slider always shows the real height: when drawers force a raise, write it back so later changes (underlay, tatami) stay inside it
  useEffect(() => {
    if (build.raisedHeight && build.raisedHeight > params.finalHeight + 1e-6) setParams((q) => ({ ...q, finalHeight: build.raisedHeight!, heightOption: 0 }))
  }, [build.raisedHeight, params.finalHeight])
  const tatamiOptions = useMemo(() => suggestTatami(floorRects(build.params), params), [build.params, params])
  const tatami = tatamiOptions.find((o) => o.id === params.tatamiPattern) ?? tatamiOptions[0]
  const mats = tatami?.mats ?? []
  const isLift = (m: { x: number; y: number }) => params.liftTables.some((l) => Math.abs(l.x - m.x) < 0.01 && Math.abs(l.y - m.y) < 0.01)
  const matsNoLift = mats.filter((m) => !isLift(m))

  useEffect(() => {
    const ok = params.liftTables.filter((l) => mats.some((m) => Math.abs(l.x - m.x) < 0.01 && Math.abs(l.y - m.y) < 0.01 && Math.abs(m.w - params.tatamiShort) < 0.01 && Math.abs(m.l - params.tatamiShort) < 0.01))
    if (ok.length !== params.liftTables.length) setParams((q) => ({ ...q, liftTables: ok }))
  }, [mats, params.liftTables, params.tatamiShort])

  const csv = () => {
    const blob = new Blob([toCsv(build, matsNoLift, units)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'raised-floor-cutlist.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const worst = structural.issues.some((i) => i.severity === 'fail') ? 'fail' : structural.issues.length ? 'warn' : 'ok'

  return (
    <div className="app">
      <header>
        <h1>Raised floor cut list</h1>
        <div className="actions">
          <div className="seg">
            <button className={units === 'imperial' ? 'on' : ''} onClick={() => setUnits('imperial')}>in</button>
            <button className={units === 'metric' ? 'on' : ''} onClick={() => setUnits('metric')}>mm</button>
          </div>
          <button className={demo !== null ? 'on' : ''} onClick={demo !== null ? stopDemo : startDemo}>{demo !== null ? 'Stop demo' : 'Demo'}</button>
          <button onClick={csv}>CSV</button>
          <button onClick={() => window.print()}>Print</button>
        </div>
      </header>
      <main>
        <aside>
          <InputPanel p={params} set={setParams} units={units} build={build} />
        </aside>
        <div className="results">
          {(build.warnings.length > 0 || structural.issues.length > 0) && (
            <ul className="warnings">
              {[...build.warnings, ...structural.issues.filter((i) => /recommended|between supports|unbraced|roll/.test(i.text)).map((i) => i.text)].map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <nav className="tabs">
            {([['3d', '3D view'], ['tatami', 'Tatami'], ['cut', 'Cut list'], ['cost', 'Cost report'], ['load', 'Load & weak points']] as [Tab, string][]).map(([id, label]) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                {label}
                {id === 'load' && <i className={`dot ${worst}`} />}
              </button>
            ))}
          </nav>
          {tab === '3d' && (
            <div className="viewer">
              <div className="toggles layers">
                <button type="button" className="layertoggle" onClick={() => setLayersOpen(!layersOpen)}>
                  {layersOpen ? '▾ Layers' : '▸ Layers'}
                </button>
                {layersOpen && (<>
                {(Object.keys(LAYER_LABELS) as LayerKey[]).filter((k) => !FEATURE_KEYS.includes(k)).map(layerRow)}
                <div className="layerhead">Features</div>
                {FEATURE_KEYS.map(layerRow)}
                <label>
                  <input type="checkbox" checked={view.loadMap} onChange={(e) => setView({ ...view, loadMap: e.target.checked })} />
                  Load map
                </label>
                <label>
                  <input type="checkbox" checked={view.dims} onChange={(e) => setView({ ...view, dims: e.target.checked })} />
                  Bin / drawer dimensions
                </label>
                </>)}
              </div>
              <Viewer3D build={build} structural={structural} mats={matsNoLift} opts={view} units={units} pullTo={demoPulls} onDrawer={(key, on) => setParams((q) => ({ ...q, drawerOff: { ...q.drawerOff, [key]: !on }, heightOption: 0 }))} onSplit={(key, mode) => setParams((q) => {
                const next = { ...q.binSplit }
                if (mode) next[key] = mode
                else delete next[key]
                return { ...q, binSplit: next }
              })} onAdjust={(kind, d, s, c, y) => setParams((q) => {
                if (kind === 'joist') {
                  if (d < 0 && (build.layout.sections[s]?.cols.length ?? 0) <= 1) return q
                  const cur = q.secAdjust?.[s] ?? { x: 0, y: 0 }
                  return { ...q, secAdjust: { ...q.secAdjust, [s]: { ...cur, x: cur.x + d } }, moves: {} }
                }
                const key = `${s}:${c}`
                const st = build.layout.sections[s]?.colStretches?.[c]
                if (st) {
                  const i = st.findIndex((r) => r.ok && (y ?? 0) >= r.y - 0.01 && (y ?? 0) <= r.y + r.l + 0.01)
                  if (i < 0 || (d < 0 && st[i].n <= 0)) return q
                  const ns = st.map((r) => r.n)
                  ns[i] += d
                  return { ...q, fixedCounts: { ...q.fixedCounts, [key]: ns }, moves: {} }
                }
                return { ...q, colAdjust: { ...q.colAdjust, [key]: (q.colAdjust?.[key] ?? 0) + d }, moves: {} }
              })}               onMove={(key, v) => setParams((q) => ({ ...q, moves: { ...q.moves, [key]: v } }))} />
              <div className="hud">
                {structural.cells.length} cells - frame {build.supportHeight.toFixed(2)}" - weakest {Math.round(structural.minPsf)} psf
              </div>
            </div>
          )}
          {tab === 'tatami' && (
            <TatamiTab
              build={build}
              options={tatamiOptions}
              selected={tatami?.id ?? ''}
              onSelect={(id) => setParams({ ...params, tatamiPattern: id as Params['tatamiPattern'], liftTables: [] })}
              anchor={params.tatamiAnchor}
              onAnchor={(a) => setParams({ ...params, tatamiAnchor: a, liftTables: [] })}
              units={units}
              lifts={params.liftTables}
              onToggleLift={(x, y) =>
                setParams((q) => {
                  const has = q.liftTables.some((l) => Math.abs(l.x - x) < 0.01 && Math.abs(l.y - y) < 0.01)
                  return { ...q, liftTables: has ? q.liftTables.filter((l) => !(Math.abs(l.x - x) < 0.01 && Math.abs(l.y - y) < 0.01)) : [...q.liftTables, { x, y }] }
                })
              }
            />
          )}
          {tab === 'cut' && (
            <CutListTab
              build={build}
              mats={matsNoLift}
              units={units}
              onPrice={(k, v) => setParams((q) => ({ ...q, prices: { ...q.prices, ...(v === undefined ? {} : { [k]: v }) } }))}
            />
          )}
          {tab === 'cost' && (
            <CostTab
              build={build}
              mats={matsNoLift}
              units={units}
              onPrice={(k, v) => setParams((q) => ({ ...q, prices: { ...q.prices, ...(v === undefined ? {} : { [k]: v }) } }))}
              onResetPrices={() => setParams((q) => ({ ...q, prices: {} }))}
            />
          )}
          {tab === 'load' && (
            <LoadTab
              onWebOc={(n) => setParams((q) => ({ ...q, webOc: n }))}
               onPeople={(n) => setParams((q) => ({ ...q, peopleAdj: n }))}
              mats={mats}
              units={units}
              s={structural}
              build={build}
              apply={(id) => {
                const s = structural.suggestions.find((x) => x.id === id)
                if (s?.apply) setParams(s.apply(params))
              }}
            />
          )}
        </div>
      </main>
      {demo !== null && (
        <div className="demo-cap" onClick={stopDemo} title="Click to stop">
          <span>{DEMO_CAPTIONS[demo]}</span>
          <i style={{ animationDuration: DEMO_MS + 'ms' }} />
        </div>
      )}
    </div>
  )
}
