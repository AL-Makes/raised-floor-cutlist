import { useMemo, useState } from 'react'
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

export default function App() {
  const [params, setParams] = useState<Params>(defaultParams)
  const [units, setUnits] = useState<UnitSystem>('imperial')
  const [tab, setTab] = useState<Tab>('3d')
  const [view, setView] = useState<ViewOptions>(defaultView)
  const setLayer = (k: LayerKey, patch: Partial<Layer>) =>
    setView((v) => ({ ...v, layers: { ...v.layers, [k]: { ...v.layers[k], ...patch } } }))

  const build = useMemo(() => buildFloor(params), [params])
  const structural = useMemo(() => analyze(build), [build])
  const tatamiOptions = useMemo(() => suggestTatami(floorRects(build.params), params), [build.params, params])
  const tatami = tatamiOptions.find((o) => o.id === params.tatamiPattern) ?? tatamiOptions[0]
  const mats = tatami?.mats ?? []

  const csv = () => {
    const blob = new Blob([toCsv(build, mats, units)], { type: 'text/csv' })
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
              </div>
              <Viewer3D build={build} structural={structural} mats={mats} opts={view} onAdjust={(kind, d) => setParams((q) => (kind === 'joist' ? { ...q, joistAdjust: q.joistAdjust + d } : { ...q, crossAdjust: q.crossAdjust + d }))} />
              <div className="hud">
                {structural.cells.length} cells - frame {build.supportHeight.toFixed(2)}" - weakest {Math.round(structural.minPsf)} psf
              </div>
            </div>
          )}
          {tab === 'tatami' && (
            <TatamiTab build={build} options={tatamiOptions} selected={tatami?.id ?? ''} onSelect={(id) => setParams({ ...params, tatamiPattern: id as Params['tatamiPattern'] })} units={units} />
          )}
          {tab === 'cut' && <CutListTab build={build} mats={mats} units={units} />}
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
