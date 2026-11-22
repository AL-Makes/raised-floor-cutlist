import { useEffect, useMemo, useState } from 'react'
import { InputPanel } from './components/InputPanel'
import { CutListTab, LoadTab } from './components/Results'
import { TatamiTab } from './components/TatamiTab'
import { Viewer3D, LAYER_LABELS, defaultView, type Layer, type LayerKey, type ViewOptions } from './components/Viewer3D'
import { buildFloor, defaultParams } from './lib/build'
import { toCsv } from './lib/export'
import { analyze } from './lib/structural'
import { suggestTatami } from './lib/tatami'
import { floorRects } from './lib/layout'
import type { Params } from './lib/types'
import type { UnitSystem } from './lib/units'
import './App.css'

type Tab = '3d' | 'tatami' | 'cut' | 'load'

const STORE = 'raised-floor-cutlist:v1'
function loadSaved(): { params?: Partial<Params>; units?: UnitSystem; tab?: Tab; view?: Partial<ViewOptions> } {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export default function App() {
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

  const build = useMemo(() => buildFloor(params), [params])
  const structural = useMemo(() => analyze(build), [build])
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
            {([['3d', '3D view'], ['tatami', 'Tatami'], ['cut', 'Cut list'], ['load', 'Load & weak points']] as [Tab, string][]).map(([id, label]) => (
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
                {(Object.keys(LAYER_LABELS) as LayerKey[]).map((k) => (
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
                ))}
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
              <Viewer3D build={build} structural={structural} mats={matsNoLift} opts={view} units={units} onAdjust={(kind, d, s) => setParams((q) => {
                const cur = q.secAdjust?.[s] ?? { x: 0, y: 0 }
                const nx = kind === 'joist' ? { ...cur, x: cur.x + d } : { ...cur, y: cur.y + d }
                return { ...q, secAdjust: { ...q.secAdjust, [s]: nx }, moves: {} }
              })}               onMove={(key, v) => setParams((q) => ({ ...q, moves: { ...q.moves, [key]: v } }))} />
              <div className="hud">
                {Object.keys(params.moves ?? {}).length > 0 && <button type="button" className="layertoggle" onClick={() => setParams((q) => ({ ...q, moves: {} }))}>Reset joist positions</button>}
                                            Drag a joist to move it -
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
          {tab === 'cut' && <CutListTab build={build} mats={matsNoLift} units={units} />}
          {tab === 'load' && (
            <LoadTab
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
    </div>
  )
}
