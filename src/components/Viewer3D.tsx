import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { CanvasTexture, Plane, Vector3 } from 'three'
import { Edges, Html, OrbitControls } from '@react-three/drei'
import type { Build } from '../lib/build'
import { memberLoads, type Structural, type Status } from '../lib/structural'
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
  tatami: 'Tatami layer',
  deck: 'Plywood layer',
  side: 'Side panels / trim',
  cross: 'Cross joists (side to side)',
  joists: 'Main joists (front to back)',
  frame: 'Rims & headers',
  underlay: 'Acoustic underlay',
  lift: 'Motorized lift tables',
  drawers: 'Drawer boxes',
  bins: 'Bins',
}

export const FEATURE_KEYS: LayerKey[] = ['lift', 'drawers', 'bins']

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
  if (kind === 'trim' || kind === 'cutout') return 'side'
  if (kind === 'joist' || kind === 'buildup') return 'joists'
  if (kind === 'block') return 'cross'
  if (kind === 'lift') return 'lift'
  if (kind === 'service') return 'cross'
  if (kind === 'bin') return 'bins'
  if (kind === 'drawer' || kind === 'wheel') return 'drawers'
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
  hatch: '#9ccf8f',
  service: '#e0a030',
  drawer: '#9fb8c8',
  wheel: '#2b2b2b',
  bin: '#3a7bd5',
  trim: '#d9c3a0',
  cutout: '#d9c3a0',
  backer: '#caa56c',
  lift: '#e67e22',
  underlay: '#7a8f5a',
  web: '#a88454',
}

const STATUS_COLOR: Record<Status, string> = { ok: '#2ecc71', warn: '#f1c40f', fail: '#e74c3c' }

interface Hover { id: string; kind: 'joist' | 'block'; delta: 1 | -1; s: number; c: number; pos: [number, number, number]; ghost?: Placement }
interface Void { id: string; kind: 'joist' | 'block'; s: number; c: number; zone: Placement; ghost: Placement }

/** joist click-and-drag is switched off while the plywood layer is reworked */
const DRAG_ENABLED = false
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

interface Pull { key: string; dir: 'out' | 'up'; max: number; start: number; base: number; anchor: [number, number, number] }

function PullController({ pull, onMove, onEnd }: { pull: Pull | null; onMove: (key: string, v: number) => void; onEnd: () => void }) {
  const { camera, gl, raycaster, controls } = useThree()
  useEffect(() => {
    if (!pull) return
    const oc = controls as unknown as { enabled: boolean } | null
    if (oc) oc.enabled = false
    const look = new Vector3()
    camera.getWorldDirection(look)
    const normal = pull.dir === 'out' ? new Vector3(0, 1, 0) : new Vector3(look.x, 0, look.z).normalize()
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(...pull.anchor))
    const hit = new Vector3()
    const move = (ev: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect()
      raycaster.setFromCamera({ x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 } as never, camera)
      if (!raycaster.ray.intersectPlane(plane, hit)) return
      const v = (pull.dir === 'out' ? hit.z : hit.y) - pull.start
      onMove(pull.key, Math.min(pull.max, Math.max(0, pull.base + v)))
    }
    const up = () => onEnd()
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (oc) oc.enabled = true
    }
  }, [pull, camera, gl, raycaster, controls, onMove, onEnd])
  return null
}

function PullArrow({ pos, dir, onOver, onOut, onDown }: { pos: [number, number, number]; dir: 'out' | 'up'; onOver: () => void; onOut: () => void; onDown: (pt: { x: number; y: number; z: number }) => void }) {
  return (
    <group position={pos} rotation={dir === 'out' ? [Math.PI / 2, 0, 0] : [0, 0, 0]} onPointerOver={(e) => { e.stopPropagation(); onOver() }} onPointerOut={onOut} onPointerDown={(e) => { e.stopPropagation(); onDown(e.point) }}>
      <mesh position={[0, 5, 0]} renderOrder={10}>
        <cylinderGeometry args={[0.7, 0.7, 8, 16]} />
        <meshStandardMaterial color="#2d8cff" transparent opacity={0.55} depthWrite={false} />
      </mesh>
      <mesh position={[0, 11, 0]} renderOrder={10}>
        <coneGeometry args={[2, 5, 16]} />
        <meshStandardMaterial color="#2d8cff" transparent opacity={0.55} depthWrite={false} />
      </mesh>
    </group>
  )
}
function CamCmd({ cmd, target, span }: { cmd: { current: ((v: string) => void) | null }; target: [number, number, number]; span: number }) {
  const { camera, controls } = useThree() as { camera: { position: { set: (x: number, y: number, z: number) => void } }; controls: { target: { set: (x: number, y: number, z: number) => void }; update: () => void } | null }
  cmd.current = (v) => {
    const [x, y, z] = target
    const d = span * 1.6
    const pos: Record<string, [number, number, number]> = {
      reset: [x + span * 0.3, span * 0.9, span * 1.1],
      top: [x, d + y, z + 0.01],
      front: [x, y, z + d],
      side: [x + d, y, z],
    }
    const q = pos[v]
    if (!q) return
    camera.position.set(q[0], q[1], q[2])
    controls?.target.set(x, y, z)
    controls?.update()
  }
  return null
}

function Wheel({ p }: { p: Placement }) {
  const r = p.sz / 2
  return (
    <mesh position={[p.x + p.sx / 2, p.z + r, -(p.y + p.sy / 2)]} rotation={[0, 0, Math.PI / 2]}>
      <cylinderGeometry args={[r, r, p.sx, 20]} />
      <meshStandardMaterial color={COLORS.wheel} />
    </mesh>
  )
}

function Box({ p, color, opacity = 1, edge = '#3b2a14', onOver, onOut, onDown, onClick, onContext }: { p: Placement; color: string; opacity?: number; edge?: string; onOver?: () => void; onOut?: () => void; onDown?: (pt: { x: number; y: number; z: number }) => void; onClick?: () => void; onContext?: () => void }) {
  return (
    <mesh
      position={[p.x + p.sx / 2, p.z + p.sz / 2, -(p.y + p.sy / 2)]}
      onContextMenu={onContext ? (e) => { e.stopPropagation(); onContext() } : undefined}
      onPointerOver={onOver ? (e) => { e.stopPropagation(); onOver() } : undefined}
      onPointerOut={onOut}
      onPointerDown={onDown ? (e) => { e.stopPropagation(); onDown(e.point) } : undefined}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      userData={onClick ? { bin: true } : undefined}
      renderOrder={opacity < 1 ? 5 : 0}
    >
      <boxGeometry args={[p.sx, p.sz, p.sy]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
      <Edges color={edge} threshold={15} />
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
    const tall = p.sy > p.sx
    const PPI = 24 // texture pixels per world unit, so text is the same physical size on every block
    const W = Math.max(8, Math.round(p.sx * PPI))
    const H = Math.max(8, Math.round(p.sy * PPI))
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    // labels run along the long side of the bin
    if (tall) { g.translate(W / 2, H / 2); g.rotate(Math.PI / 2); g.translate(-W / 2, -H / 2) }
    const lw = (tall ? H : W) * 0.94
    const lh = (tall ? W : H) * 0.94
    const lines = [`${formatLength(Math.max(p.sx, p.sy), units)} × ${formatLength(Math.min(p.sx, p.sy), units)}`, `H ${formatLength(p.sz, units)}`]
    let fs = 2 * PPI
    const widest = (f: number) => { g.font = `bold ${f}px sans-serif`; return Math.max(...lines.map((t) => g.measureText(t).width)) + f / 3 }
    // shrink until every line fits on the top face
    while (fs > 3 && (widest(fs) > lw || fs * 1.2 * lines.length > lh)) fs *= 0.93
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
    sec.cols.forEach((col, ci) => {
      const ys = [rect.y + T, ...[...sec.colBlocks[ci]].sort((a, b) => a - b).flatMap((y) => [y, y + T]), rect.y + rect.l - T]
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
          s: si,
          c: ci,
          ghost: { kind: 'block', x: col.x, y: (y0 + y1) / 2 - gt / 2, z, sx: col.w, sy: gt, sz },
          zone: { kind: 'block', x: col.x, y: (y0 + y1) / 2 - gap * 0.18, z, sx: col.w, sy: gap * 0.36, sz },
        })
      }
    })
  })
  return out
}

export function Viewer3D({ build, mats, opts, onAdjust, onMove, onSplit, onDrawer, units = 'imperial' }: { build: Build; structural?: Structural; mats: Mat[]; opts: ViewOptions; onAdjust: (kind: 'joist' | 'block', delta: number, s: number, c: number) => void; onMove: (key: string, v: number) => void; onSplit: (key: string, mode: 'x' | 'y' | null) => void; onDrawer: (key: string, on: boolean) => void; units?: UnitSystem }) {
  const [binSel, setBinSel] = useState<{ cell: number; split?: 'x' | 'y'; pos: [number, number, number] } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; bin?: { cell: number; split?: 'x' | 'y' } } | null>(null)
  const ctxBin = useRef<{ cell: number; split?: 'x' | 'y' } | undefined>(undefined)
  const camCmd = useRef<((v: string) => void) | null>(null)
  const [hover, setHoverState] = useState<Hover | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const endDrag = useMemo(() => () => setDrag(null), [])
  const [pulls, setPulls] = useState<Record<string, number>>({})
  const [armed, setArmed] = useState<string | null>(null)
  const [pull, setPull] = useState<Pull | null>(null)
  const endPull = useMemo(() => () => setPull(null), [])
  const movePull = useMemo(() => (k: string, v: number) => setPulls((q) => ({ ...q, [k]: v })), [])
  const armTimer = useRef<number | undefined>(undefined)
  const arm = (k: string) => { window.clearTimeout(armTimer.current); setArmed(k) }
  const disarm = () => { if (pull) return; window.clearTimeout(armTimer.current); armTimer.current = window.setTimeout(() => setArmed(null), 600) }
  const [bay, setBayState] = useState<number | null>(null)
  const bayTimer = useRef<number | undefined>(undefined)
  const setBay = (c: number) => { window.clearTimeout(bayTimer.current); setBayState(c) }
  const leaveBay = () => { window.clearTimeout(bayTimer.current); bayTimer.current = window.setTimeout(() => setBayState(null), 700) }
  const timer = useRef<number | undefined>(undefined)
  const setHover = (h: Hover) => { window.clearTimeout(timer.current); setHoverState(h) }
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHoverState(null), 700) }
  const keep = () => window.clearTimeout(timer.current)
  const voids = useMemo(() => findVoids(build), [build])
  const act = (h: Hover) => { onAdjust(h.kind, h.delta, h.s, h.c); setHoverState(null) }
  const g = build.geometry
  const cx = g.width / 2
  const cz = -g.length / 2
  const span = Math.max(g.width, g.length, 60)
  const S = build.supportHeight
  const ply = build.params.plyThickness
  const members = useMemo(() => (opts.loadMap ? memberLoads(build) : []), [build, opts.loadMap])
  const memberOf = new Map(members.filter((m) => m.kind !== 'pad').map((m) => [m.index, m]))
  const L = opts.layers
  const front = g.front
  const pullKey = (p: Placement) => (p.lift !== undefined ? `l${p.lift}` : (p.kind === 'drawer' || p.kind === 'wheel' || p.kind === 'cutout') && p.cell !== undefined ? `d${p.cell}` : undefined)
  const placed = build.placements.map((p) => {
    const k = pullKey(p)
    const v = k ? pulls[k] ?? 0 : 0
    return !v ? p : k![0] === 'l' ? { ...p, z: p.z + v } : { ...p, y: p.y - v }
  })
  const armInfo = (() => {
    if (!armed) return null
    const mine = placed.filter((p) => pullKey(p) === armed)
    if (armed[0] === 'l') {
      const top = mine.reduce<Placement | undefined>((a, b) => (!a || b.z > a.z ? b : a), undefined)
      if (!top) return null
      return { dir: 'up' as const, max: 24, anchor: [top.x + top.sx / 2, top.z + top.sz + 1, -(top.y + top.sy / 2)] as [number, number, number] }
    }
    const parts = mine.filter((p) => p.kind === 'drawer')
    if (!parts.length) return null
    const fy = Math.min(...mine.filter((p) => p.kind !== 'wheel').map((p) => p.y))
    const x0 = Math.min(...parts.map((p) => p.x)), x1 = Math.max(...parts.map((p) => p.x + p.sx))
    const z0 = Math.min(...parts.map((p) => p.z)), z1 = Math.max(...parts.map((p) => p.z + p.sz))
    const max = Math.max(...parts.map((p) => p.y + p.sy)) - Math.min(...parts.map((p) => p.y))
    return { dir: 'out' as const, max, anchor: [(x0 + x1) / 2, (z0 + z1) / 2, -fy + 1] as [number, number, number] }
  })()
  return (
    <div style={{ position: 'absolute', inset: 0 }} onContextMenu={(e) => {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      window.setTimeout(() => { setMenu({ x, y, bin: ctxBin.current }); ctxBin.current = undefined }, 0)
    }} onPointerDown={() => menu && setMenu(null)}>
    <Canvas camera={{ position: [cx + span * 0.3, span * 0.9, span * 1.1], fov: 45, near: 1, far: 5000 }} style={{ touchAction: 'none' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[cx + 100, 250, 150]} intensity={1.1} />
      <OrbitControls target={[cx, S / 2, cz]} makeDefault mouseButtons={{ LEFT: 0, MIDDLE: 2 }} />
      <CamCmd cmd={camCmd} target={[cx, S / 2, cz]} span={span} />
      <DragController drag={drag} onMove={onMove} onEnd={endDrag} />
      <PullController pull={pull} onMove={movePull} onEnd={endPull} />
      {armInfo && (L.drawers.visible || L.lift.visible) && (pull ? pull.key === armed : true) && (
        <PullArrow
          pos={armInfo.anchor}
          dir={armInfo.dir}
          onOver={() => arm(armed!)}
          onOut={disarm}
          onDown={(pt) => { const k = armed!; setPull({ key: k, dir: armInfo.dir, max: armInfo.max, start: armInfo.dir === 'out' ? pt.z : pt.y, base: pulls[k] ?? 0, anchor: [pt.x, pt.y, pt.z] }) }}
        />
      )}
      <gridHelper args={[span * 2.5, 20, '#888', '#ccc']} position={[cx, -0.05, cz]} />
      {front && (
        <mesh position={[(front.x1 + front.x2) / 2, 0.15, 3]}>
          <boxGeometry args={[Math.max(front.x2 - front.x1, 1), 0.3, 2]} />
          <meshStandardMaterial color="#e67e22" />
        </mesh>
      )}
      {placed.map((p, i) => {
        const key = layerOf(p.kind)
        const layer = L[key]
        if (!layer.visible) return null
        const edit = p.kind === 'block'
        const id = `p${i}`
        const dragging = !!drag && !!p.ref && drag.ref.s === p.ref.s && drag.ref.axis === p.ref.axis && drag.ref.k === p.ref.k
        const mem = memberOf.get(i)
        const pk = pullKey(p)
        const color = dragging ? '#2ecc71' : hover?.id === id ? '#e57373' : mem ? STATUS_COLOR[mem.status] : COLORS[p.kind] ?? '#999'
        const over = edit && !drag ? () => setHover({ id, kind: 'block', delta: -1, s: p.ref!.s, c: p.ref!.c ?? 0, pos: [p.x + p.sx / 2, p.z + p.sz + 0.5, -(p.y + p.sy / 2)] }) : undefined
        const down = DRAG_ENABLED && p.ref
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
        if (p.kind === 'wheel') return <Wheel key={i} p={p} />
        return (
          <Box
            key={i}
            p={p}
            color={binSel && p.kind === 'bin' && p.cell === binSel.cell ? '#4fa3e0' : color}
            opacity={layer.opacity}
            onOver={pk && (p.kind === 'cutout' || p.kind === 'drawer' || p.lift !== undefined) ? () => { arm(pk); if (p.cell !== undefined && p.lift === undefined) setBay(p.cell) } : over}
            onOut={pk && (p.kind === 'cutout' || p.kind === 'drawer' || p.lift !== undefined) ? () => { disarm(); leaveBay() } : edit ? leave : undefined}
            onDown={down}
            onClick={p.kind === 'bin' && p.cell !== undefined ? () => setBinSel({ cell: p.cell!, split: p.split, pos: [p.x + p.sx / 2, p.z + p.sz + 1, -(p.y + p.sy / 2)] }) : undefined}
            onContext={p.kind === 'bin' && p.cell !== undefined ? () => { ctxBin.current = { cell: p.cell!, split: p.split } } : undefined}
          />
        )
      })}
      {placed.map((p, i) => {
        if (!opts.dims || p.kind !== 'bin' || !L[layerOf(p.kind)].visible) return null
        return <DimPlane key={`dim${i}`} p={p} y={p.z + p.sz + 0.04} units={units} />
      })}
      {voids.filter((v) => L[v.kind === 'joist' ? 'joists' : 'cross'].visible).map((v) => (
        <mesh
          key={v.id}
          position={[v.zone.x + v.zone.sx / 2, v.zone.z + v.zone.sz / 2, -(v.zone.y + v.zone.sy / 2)]}
          onPointerOver={(e) => { if (e.intersections.some((h) => h.object.userData.bin)) { setHoverState(null); return } e.stopPropagation(); setHover({ id: v.id, kind: v.kind, delta: 1, s: v.s, c: v.c, ghost: v.ghost, pos: [v.ghost.x + v.ghost.sx / 2, v.ghost.z + v.ghost.sz + 0.5, -(v.ghost.y + v.ghost.sy / 2)] }) }}
          onPointerOut={leave}
        >
          <boxGeometry args={[v.zone.sx, v.zone.sz, v.zone.sy]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
      {L.drawers.visible && build.params.features.drawers && build.layout.cells.filter((c) => c.drawerBay).map((c) => {
        const on = c.type === 'drawer'
        const pull0 = pulls[`d${c.index}`] ?? 0
        return (
          <group key={`bay${c.index}`}>
            {!on && (
              <mesh position={[c.x + c.w / 2, S / 2, -(c.y + c.l / 2)]} onPointerOver={(e) => { e.stopPropagation(); setBay(c.index) }} onPointerOut={leaveBay}>
                <boxGeometry args={[c.w, S, c.l]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            )}
            {bay === c.index && (
              <Html position={[c.x + c.w / 2, S * 0.85, -(c.y) + 2 + pull0]} center zIndexRange={[20, 0]}>
                <div className="binpop" onPointerEnter={() => setBay(c.index)} onPointerLeave={leaveBay}>
                  <button onClick={() => { onDrawer(c.key, !on); setBayState(null) }}>{on ? 'Delete drawer' : 'Add drawer'}</button>
                </div>
              </Html>
            )}
          </group>
        )
      })}      {hover?.ghost && (
        <mesh position={[hover.ghost.x + hover.ghost.sx / 2, hover.ghost.z + hover.ghost.sz / 2, -(hover.ghost.y + hover.ghost.sy / 2)]} raycast={() => null}>
          <boxGeometry args={[hover.ghost.sx, hover.ghost.sz, hover.ghost.sy]} />
          <meshStandardMaterial color="#2ecc71" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      )}
      {binSel && (() => {
        const cell = build.layout.cells[binSel.cell]
        if (!cell) return null
        const go = (m: 'x' | 'y' | null) => { onSplit(cell.key, m); setBinSel(null) }
        return (
          <Html position={binSel.pos} center zIndexRange={[20, 0]}>
            <div className="binpop">
              {binSel.split ? (
                <button onClick={() => go(null)}>Recombine</button>
              ) : (
                <>
                  <button title="Swap to the next smaller standard IKEA bin size" onClick={() => go('x')}>Split to smaller bin</button>
                </>
              )}
              <button onClick={() => setBinSel(null)}>×</button>
            </div>
          </Html>
        )
      })()}
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
      {opts.loadMap &&
        members.filter((m) => m.kind === 'pad').map((m, k) => {
          const j = build.placements[m.index]
          const h = Math.max(j.z, 0.4)
          const pl: Placement = { kind: 'block', x: j.x + j.sx / 2 - 1.5, y: Math.min(Math.max(m.y! - 1.5, j.y), j.y + j.sy - 3), z: 0, sx: 3, sy: 3, sz: h }
          return <Box key={'pad' + k} p={pl} color={STATUS_COLOR[m.status]} opacity={1} />
        })}
      {L.tatami.visible &&
        mats.map((m, i) => {
          const pl: Placement = { kind: 'bin', x: m.x + 0.1, y: m.y + 0.1, z: S + ply, sx: m.w - 0.2, sy: m.l - 0.2, sz: build.params.tatamiThickness }
          return <Box key={`m${i}`} p={pl} color={m.kind === 'cut' ? '#c9a66b' : '#b7c78a'} opacity={L.tatami.opacity} />
        })}
    </Canvas>
    {menu && (
      <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {menu.bin && (
          <>
            {menu.bin.split ? (
              <button onClick={() => { onSplit(build.layout.cells[menu.bin!.cell].key, null); setMenu(null) }}>Recombine bins</button>
            ) : (
              <>
                <button onClick={() => { onSplit(build.layout.cells[menu.bin!.cell].key, 'x'); setMenu(null) }}>Split to smaller standard bin</button>
              </>
            )}
            <hr />
          </>
        )}
        {[['reset', 'Reset view'], ['top', 'Top view'], ['front', 'Front view'], ['side', 'Side view']].map(([k, label]) => (
          <button key={k} onClick={() => { camCmd.current?.(k); setMenu(null) }}>{label}</button>
        ))}
      </div>
    )}
    </div>
  )
}
