import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CanvasTexture, Plane, Vector3 } from 'three'
import { Edges, Html, OrbitControls } from '@react-three/drei'
import type { Build } from '../lib/build'
import type { Structural, Status } from '../lib/structural'
import type { Mat } from '../lib/tatami'
import type { Placement } from '../lib/types'
import { formatLength, type UnitSystem } from '../lib/units'

export type LayerKey = 'joists' | 'cross' | 'frame' | 'side' | 'deck' | 'tatami' | 'lift' | 'bins' | 'drawers' | 'underlay'
export interface Layer {
  visible: boolean
  opacity: number
}
export interface ViewOptions {
  layers: Record<LayerKey, Layer>
  loadMap: boolean
  dims: boolean
}

export const LAYER_LABELS: Record<LayerKey, string> = {
  joists: 'Main joists (front to back)',
  cross: 'Cross joists (side to side)',
  frame: 'Rims & headers',
  side: 'Side panels / trim / drawer faces',
  deck: 'Plywood layer',
  tatami: 'Tatami layer',
  lift: 'Motorized lift tables',
  bins: 'Bins',
  drawers: 'Drawer boxes',
  underlay: 'Acoustic underlay',
}

export const defaultView = (): ViewOptions => ({
  layers: {
    joists: { visible: true, opacity: 1 },
    cross: { visible: true, opacity: 1 },
    frame: { visible: true, opacity: 1 },
    side: { visible: true, opacity: 1 },
    deck: { visible: true, opacity: 0.6 },
    tatami: { visible: false, opacity: 1 },
    lift: { visible: true, opacity: 1 },
    bins: { visible: true, opacity: 1 },
    drawers: { visible: true, opacity: 1 },
    underlay: { visible: true, opacity: 1 },
  },
  loadMap: false,
  dims: true,
})

function layerOf(kind: string): LayerKey {
  if (kind === 'deck' || kind === 'hatch') return 'deck'
  if (kind === 'trim' || kind === 'drawerFace') return 'side'
  if (kind === 'joist' || kind === 'buildup') return 'joists'
  if (kind === 'block') return 'cross'
  if (kind === 'lift') return 'lift'
  if (kind === 'service') return 'cross'
  if (kind === 'bin') return 'bins'
  if (kind === 'drawer') return 'drawers'
  if (kind === 'underlay') return 'underlay'
  return 'frame'
}
const COLORS: Record<string, string> = {
  joist: '#c9a26b',
  rim: '#b98f55',
  block: '#d8b27a',
  buildup: '#8f6b3a',
  header: '#a87c45',
  deck: '#e9d9b4',
  hatch: '#dcc790',
  service: '#e0a030',
  drawer: '#9fb8c8',
  drawerFace: '#7da2bd',
  bin: '#3a7bd5',
  trim: '#6b4f2d',
  backer: '#caa56c',
  lift: '#e67e22',
  underlay: '#7a8f5a',
  web: '#a88454',
}

const STATUS_COLOR: Record<Status, string> = { ok: '#2ecc71', warn: '#f1c40f', fail: '#e74c3c' }

interface Hover { id: string; kind: 'joist' | 'block'; delta: 1 | -1; pos: [number, number, number]; ghost?: Placement }
interface Void { id: string; kind: 'joist' | 'block'; zone: Placement; ghost: Placement }

interface Drag { ref: NonNullable<Placement['ref']>; start: number; base: number; planeY: number }

function DragController({ drag, onMove, onEnd }: { drag: Drag | null; onMove: (key: string, v: number) => void; onEnd: () => void }) {
  const { camera, gl, raycaster, controls } = useThree()
  useEffect(() => {
    if (!drag) return
    const oc = controls as unknown as { enabled: boolean } | null
    if (oc) oc.enabled = false
    const plane = new Plane(new Vector3(0, 1, 0), -drag.planeY)
    const hit = new Vector3()
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect()
      const ndc = { x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 }
      raycaster.setFromCamera(ndc as never, camera)
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const pos = drag.ref.axis === 'x' ? hit.x : -hit.z
      const d = Math.round((pos - drag.start) * 8) / 8
      onMove(`${drag.ref.s}:${drag.ref.axis}:${drag.ref.k}`, drag.base + d)
    }
    const up = () => onEnd()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (oc) oc.enabled = true
    }
  }, [drag, camera, gl, raycaster, controls, onMove, onEnd])
  return null
}

function Box({ p, color, opacity = 1, onOver, onOut, onDown }: { p: Placement; color: string; opacity?: number; onOver?: () => void; onOut?: () => void; onDown?: (pt: { x: number; y: number; z: number }) => void }) {
  return (
    <mesh
      position={[p.x + p.sx / 2, p.z + p.sz / 2, -(p.y + p.sy / 2)]}
      onPointerOver={onOver ? (e) => { e.stopPropagation(); onOver() } : undefined}
      onPointerOut={onOut}
      onPointerDown={onDown ? (e) => { e.stopPropagation(); onDown(e.point) } : undefined}
      renderOrder={opacity < 1 ? 5 : 0}
    >
      <boxGeometry args={[p.sx, p.sz, p.sy]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
      <Edges color="#3b2a14" threshold={15} />
    </mesh>
  )
}

function builtUp(p: Placement): { chord: Placement[]; web: Placement[] } {
  const c = 1.5
  const alongY = p.sy >= p.sx
  const len = alongY ? p.sy : p.sx
  const chord = [p.z, p.z + p.sz - c].map((z) => ({ ...p, z, sz: c }))
  const n = Math.max(2, Math.ceil(len / 16) + 1)
  const web = Array.from({ length: n }, (_, i) => {
    const o = (i * Math.max(0, len - c)) / (n - 1)
    return alongY ? { ...p, y: p.y + o, sy: Math.min(c, len), z: p.z + c, sz: p.sz - 2 * c } : { ...p, x: p.x + o, sx: Math.min(c, len), z: p.z + c, sz: p.sz - 2 * c }
  })
  return { chord, web }
}

/** Dimensions printed flat on the surface, as a transparent canvas texture lying over the object's footprint. */
function DimPlane({ p, y, units }: { p: Placement; y: number; units: UnitSystem }) {
  const tex = useMemo(() => {
    const PPI = 24 // texture pixels per world unit, so text is the same physical size on every block
    const W = Math.max(64, Math.round(p.sx * PPI))
    const H = Math.max(64, Math.round(p.sy * PPI))
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    const lines = [`${formatLength(p.sx, units)} × ${formatLength(p.sy, units)}`, `H ${formatLength(p.sz, units)}`]
    const fs = 2 * PPI
    g.font = `bold ${fs}px sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = fs / 6
    g.strokeStyle = '#000'
    g.fillStyle = '#fff'
    lines.forEach((t, k) => {
      const yy = H / 2 + (k - (lines.length - 1) / 2) * fs * 1.2
      g.strokeText(t, W / 2, yy)
      g.fillText(t, W / 2, yy)
    })
    const t = new CanvasTexture(c)
    t.anisotropy = 4
    return t
  }, [p.kind, p.sx, p.sy, p.sz, units])
  return (
    <mesh position={[p.x + p.sx / 2, y, -(p.y + p.sy / 2)]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={1}>
      <planeGeometry args={[p.sx, p.sy]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

function findVoids(build: Build): Void[] {
  const ref = build.placements.find((q) => q.kind === 'joist' || q.kind === 'rim')
  if (!ref) return []
  const z = ref.z
  const sz = ref.sz
  const out: Void[] = []
  build.layout.sections.forEach((sec, si) => {
    const { rect } = sec
    const T = sec.joistT[0] ?? 1.5
    const ys = [rect.y + T, ...[...sec.blockY].sort((a, b) => a - b).flatMap((y) => [y, y + T]), rect.y + rect.l - T]
    sec.cols.forEach((col, ci) => {
      for (let k = 0; k + 1 < ys.length; k += 2) {
        const y0 = ys[k]
        const y1 = ys[k + 1]
        const gap = y1 - y0
        if (gap < 3) continue
        const inLift = build.placements.some((q) => q.kind === 'lift' && q.x < col.x + col.w && q.x + q.sx > col.x && q.y < y1 && q.y + q.sy > y0)
        if (inLift) continue
        const gt = Math.min(T, gap * 0.5)
        out.push({
          id: `c${si}-${ci}-${k}`,
          kind: 'block',
          ghost: { kind: 'block', x: col.x, y: (y0 + y1) / 2 - gt / 2, z, sx: col.w, sy: gt, sz },
          zone: { kind: 'block', x: col.x, y: (y0 + y1) / 2 - gap * 0.18, z, sx: col.w, sy: gap * 0.36, sz },
        })
      }
    })
  })
  return out
}

export function Viewer3D({ build, structural, mats, opts, onAdjust, onMove, onToggleCut, onToggleAccess, deckMode, units = 'imperial' }: { build: Build; structural: Structural; mats: Mat[]; opts: ViewOptions; onAdjust: (kind: 'joist' | 'block', delta: number) => void; onMove: (key: string, v: number) => void; onToggleCut: (s: number, axis: 'x' | 'y', pos: number) => void; onToggleAccess: (key: string) => void; deckMode: 'cut' | 'access'; units?: UnitSystem }) {
  const [hover, setHoverState] = useState<Hover | null>(null)
  const [hoverCell, setHoverCell] = useState<string | null>(null)
  const downAt = useRef<[number, number] | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const endDrag = useMemo(() => () => setDrag(null), [])
  const timer = useRef<number | undefined>(undefined)
  const setHover = (h: Hover) => { window.clearTimeout(timer.current); setHoverState(h) }
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHoverState(null), 700) }
  const keep = () => window.clearTimeout(timer.current)
  const voids = useMemo(() => findVoids(build), [build])
  const act = (h: Hover) => { onAdjust(h.kind, h.delta); setHoverState(null) }
  const g = build.geometry
  const cx = g.width / 2
  const cz = -g.length / 2
  const span = Math.max(g.width, g.length, 60)
  const S = build.supportHeight
  const ply = build.params.plyThickness
  const status = new Map(structural.cells.map((c) => [c.cell, c.status]))
  const L = opts.layers
  const cutMode = L.deck.visible
  const front = g.front

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
    <Canvas camera={{ position: [cx + span * 0.3, span * 0.9, span * 1.1], fov: 45, near: 1, far: 5000 }} style={{ touchAction: 'none' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[cx + 100, 250, 150]} intensity={1.1} />
      <OrbitControls target={[cx, S / 2, cz]} makeDefault />
      <DragController drag={drag} onMove={onMove} onEnd={endDrag} />
      <gridHelper args={[span * 2.5, 20, '#888', '#ccc']} position={[cx, -0.05, cz]} />
      {front && (
        <mesh position={[(front.x1 + front.x2) / 2, 0.15, 3]}>
          <boxGeometry args={[Math.max(front.x2 - front.x1, 1), 0.3, 2]} />
          <meshStandardMaterial color="#e67e22" />
        </mesh>
      )}
      {build.placements.map((p, i) => {
        const key = layerOf(p.kind)
        const layer = L[key]
        if (!layer.visible) return null
        if (p.kind === 'hatch') {
          const st = p.cell !== undefined ? status.get(p.cell) : undefined
          return <Box key={i} p={p} color={opts.loadMap && st ? STATUS_COLOR[st] : COLORS.hatch} opacity={layer.opacity} />
        }
        const edit = p.kind === 'block' && !cutMode
        const id = `p${i}`
        const dragging = !!drag && !!p.ref && drag.ref.s === p.ref.s && drag.ref.axis === p.ref.axis && drag.ref.k === p.ref.k
        const color = dragging ? '#2ecc71' : hover?.id === id ? '#e57373' : COLORS[p.kind] ?? '#999'
        const over = edit && !drag ? () => setHover({ id, kind: 'block', delta: -1, pos: [p.x + p.sx / 2, p.z + p.sz + 0.5, -(p.y + p.sy / 2)] }) : undefined
        const down = p.ref && !cutMode
          ? (pt: { x: number; y: number; z: number }) => {
              setHoverState(null)
              const r = p.ref!
              setDrag({ ref: r, start: r.axis === 'x' ? pt.x : -pt.z, base: build.layout.sections[r.s]?.applied[`${r.s}:${r.axis}:${r.k}`] ?? 0, planeY: pt.y })
            }
          : undefined
        if (build.params.joistStyle === 'builtup' && (p.kind === 'joist' || p.kind === 'rim' || p.kind === 'block') && p.sz >= 3.2) {
          const bu = builtUp(p)
          return (
            <group key={i}>
              {bu.chord.map((c, k) => <Box key={`c${k}`} p={c} color={color} opacity={layer.opacity} onOver={over} onOut={edit ? leave : undefined} onDown={down} />)}
              {bu.web.map((w, k) => <Box key={`w${k}`} p={w} color={dragging ? '#2ecc71' : hover?.id === id ? '#e57373' : COLORS.web} opacity={layer.opacity} onOver={over} onOut={edit ? leave : undefined} onDown={down} />)}
            </group>
          )
        }
        return (
          <Box
            key={i}
            p={p}
            color={color}
            opacity={layer.opacity}
            onOver={over}
            onOut={edit ? leave : undefined}
            onDown={down}
          />
        )
      })}
      {build.placements.map((p, i) => {
        if (!opts.dims || (p.kind !== 'bin' && p.kind !== 'drawer') || !L[layerOf(p.kind)].visible) return null
        return <DimPlane key={`dim${i}`} p={p} y={p.z + p.sz + 0.04} units={units} />
      })}
      {!cutMode && voids.filter((v) => L[v.kind === 'joist' ? 'joists' : 'cross'].visible).map((v) => (
        <mesh
          key={v.id}
          position={[v.zone.x + v.zone.sx / 2, v.zone.z + v.zone.sz / 2, -(v.zone.y + v.zone.sy / 2)]}
          onPointerOver={(e) => { e.stopPropagation(); setHover({ id: v.id, kind: v.kind, delta: 1, ghost: v.ghost, pos: [v.ghost.x + v.ghost.sx / 2, v.ghost.z + v.ghost.sz + 0.5, -(v.ghost.y + v.ghost.sy / 2)] }) }}
          onPointerOut={leave}
        >
          <boxGeometry args={[v.zone.sx, v.zone.sz, v.zone.sy]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      {hover?.ghost && (
        <mesh position={[hover.ghost.x + hover.ghost.sx / 2, hover.ghost.z + hover.ghost.sz / 2, -(hover.ghost.y + hover.ghost.sy / 2)]} raycast={() => null}>
          <boxGeometry args={[hover.ghost.sx, hover.ghost.sz, hover.ghost.sy]} />
          <meshStandardMaterial color="#2ecc71" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
      {hover && (
        <Html position={hover.pos} center zIndexRange={[20, 0]}>
          <div className="jhit" onPointerEnter={keep} onPointerLeave={leave} onClick={() => act(hover)}>
            <button
              className={hover.delta > 0 ? 'jbtn add' : 'jbtn del'}
              title={hover.delta > 0 ? 'Add support here' : 'Delete this support'}
            >
              {hover.delta > 0 ? '+' : '−'}
            </button>
          </div>
        </Html>
      )}
      {cutMode && deckMode === 'access' &&
        build.placements.filter((q) => q.panel && (q.kind === 'deck' || q.kind === 'hatch')).map((q) => {
          const on = q.kind === 'hatch'
          const hot = hoverCell === q.panel
          return (
            <mesh
              key={`pn${q.panel}`}
              position={[q.x + q.sx / 2, q.z + q.sz + 0.1, -(q.y + q.sy / 2)]}
              onPointerOver={(e) => { e.stopPropagation(); setHoverCell(q.panel!) }}
              onPointerOut={() => setHoverCell((h) => (h === q.panel ? null : h))}
              onPointerDown={(e) => { downAt.current = [e.clientX, e.clientY] }}
              onPointerUp={(e) => { e.stopPropagation(); const d = downAt.current; if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 8) onToggleAccess(q.panel!); downAt.current = null }}
            >
              <boxGeometry args={[q.sx - 0.3, 0.1, q.sy - 0.3]} />
              <meshBasicMaterial color={on ? '#2ecc71' : '#3b82f6'} transparent opacity={hot ? 0.6 : on ? 0.4 : 0.01} depthWrite={false} />
            </mesh>
          )
        })}
      {cutMode && deckMode === 'cut' &&
        build.layout.sections.flatMap((sec) => {
          const lines: { id: string; axis: 'x' | 'y'; pos: number; cx: number; cy: number; sx: number; sy: number }[] = []
          sec.joistX.forEach((jx, k) => {
            if (k === 0 || k === sec.joistX.length - 1) return
            const pos = jx + sec.joistT[k] / 2
            lines.push({ id: `${sec.index}:x:${k}`, axis: 'x', pos, cx: pos, cy: sec.rect.y + sec.rect.l / 2, sx: 4, sy: sec.rect.l })
          })
          sec.blockY.forEach((by, k) => {
            const pos = by + build.layout.joistW / 2
            lines.push({ id: `${sec.index}:y:${k}`, axis: 'y', pos, cx: sec.rect.x + sec.rect.w / 2, cy: pos, sx: sec.rect.w, sy: 4 })
          })
          build.layout.cells.filter((c) => c.type === 'service' && c.section === sec.index).forEach((c, k) => {
            const pos = c.y + c.l / 2
            if (lines.some((l) => l.axis === 'y' && Math.abs(l.pos - pos) < 0.5)) return
            lines.push({ id: `${sec.index}:m:${k}`, axis: 'y', pos, cx: sec.rect.x + sec.rect.w / 2, cy: pos, sx: sec.rect.w, sy: 4 })
          })
          return lines.map((ln) => {
            const on = (build.params.deckCuts ?? []).some((c) => c.s === sec.index && c.axis === ln.axis && Math.abs(c.pos - ln.pos) < 0.01)
            const hot = hoverCell === ln.id
            const wide = ln.axis === 'x' ? [8, ln.sy] : [ln.sx, 8]
            const thin = ln.axis === 'x' ? [2, ln.sy] : [ln.sx, 2]
            return (
              <group key={`cl${ln.id}`}>
                <mesh position={[ln.cx, S + ply + 0.3, -ln.cy]} raycast={() => null} renderOrder={10}>
                  <boxGeometry args={[thin[0], 0.1, thin[1]]} />
                  <meshBasicMaterial color={on ? '#e53935' : '#3b82f6'} transparent opacity={hot ? 0.9 : on ? 0.9 : 0.35} depthWrite={false} depthTest={false} />
                </mesh>
                <mesh
                  position={[ln.cx, S + ply, -ln.cy]}
                  onPointerOver={(e) => { e.stopPropagation(); setHoverCell(ln.id) }}
                  onPointerOut={() => setHoverCell((h) => (h === ln.id ? null : h))}
                  onPointerDown={(e) => { downAt.current = [e.clientX, e.clientY] }}
                  onPointerUp={(e) => { e.stopPropagation(); const d = downAt.current; if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 8) onToggleCut(sec.index, ln.axis, ln.pos); downAt.current = null }}
                >
                  <boxGeometry args={[wide[0], 4, wide[1]]} />
                  <meshBasicMaterial transparent opacity={hot ? 0.15 : 0} depthWrite={false} color="#3b82f6" />
                </mesh>
              </group>
            )
          })
        })}
      {opts.loadMap &&
        L.deck.visible &&
        build.layout.cells.map((c) => {
          const st = status.get(c.index) ?? 'ok'
          const pl: Placement = { kind: 'deck', x: c.x, y: c.y, z: S + ply + 0.05, sx: c.w, sy: c.l, sz: 0.05 }
          return <Box key={`lm${c.index}`} p={pl} color={STATUS_COLOR[st]} opacity={0.8} />
        })}
      {L.tatami.visible &&
        mats.map((m, i) => {
          const pl: Placement = { kind: 'bin', x: m.x + 0.1, y: m.y + 0.1, z: S + ply, sx: m.w - 0.2, sy: m.l - 0.2, sz: build.params.tatamiThickness }
          return <Box key={`m${i}`} p={pl} color={m.kind === 'cut' ? '#c9a66b' : '#b7c78a'} opacity={L.tatami.opacity} />
        })}
    </Canvas>
    </div>
  )
}
