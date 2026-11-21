import { useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Edges, Html, OrbitControls } from '@react-three/drei'
import type { Build } from '../lib/build'
import type { Structural, Status } from '../lib/structural'
import type { Mat } from '../lib/tatami'
import type { Placement } from '../lib/types'

export type LayerKey = 'joists' | 'cross' | 'frame' | 'side' | 'deck' | 'tatami' | 'lift' | 'bins' | 'drawers'
export interface Layer {
  visible: boolean
  opacity: number
}
export interface ViewOptions {
  layers: Record<LayerKey, Layer>
  loadMap: boolean
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
  },
  loadMap: false,
})

function layerOf(kind: string): LayerKey {
  if (kind === 'deck' || kind === 'hatch') return 'deck'
  if (kind === 'trim' || kind === 'drawerFace') return 'side'
  if (kind === 'joist' || kind === 'buildup') return 'joists'
  if (kind === 'block') return 'cross'
  if (kind === 'lift') return 'lift'
  if (kind === 'bin') return 'bins'
  if (kind === 'drawer') return 'drawers'
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
  drawer: '#9fb8c8',
  drawerFace: '#7da2bd',
  bin: '#3a7bd5',
  trim: '#6b4f2d',
  backer: '#caa56c',
  lift: '#e67e22',
}

const STATUS_COLOR: Record<Status, string> = { ok: '#2ecc71', warn: '#f1c40f', fail: '#e74c3c' }

interface Hover { id: string; kind: 'joist' | 'block'; delta: 1 | -1; pos: [number, number, number]; ghost?: Placement }
interface Void { id: string; kind: 'joist' | 'block'; zone: Placement; ghost: Placement }

function Box({ p, color, opacity = 1, onOver, onOut }: { p: Placement; color: string; opacity?: number; onOver?: () => void; onOut?: () => void }) {
  return (
    <mesh
      position={[p.x + p.sx / 2, p.z + p.sz / 2, -(p.y + p.sy / 2)]}
      onPointerOver={onOver ? (e) => { e.stopPropagation(); onOver() } : undefined}
      onPointerOut={onOut}
    >
      <boxGeometry args={[p.sx, p.sz, p.sy]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
      <Edges color="#3b2a14" threshold={15} />
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

export function Viewer3D({ build, structural, mats, opts, onAdjust }: { build: Build; structural: Structural; mats: Mat[]; opts: ViewOptions; onAdjust: (kind: 'joist' | 'block', delta: number) => void }) {
  const [hover, setHoverState] = useState<Hover | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const setHover = (h: Hover) => { window.clearTimeout(timer.current); setHoverState(h) }
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHoverState(null), 250) }
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
  const front = g.front

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
    <Canvas camera={{ position: [cx + span * 0.3, span * 0.9, span * 1.1], fov: 45, near: 1, far: 5000 }} style={{ touchAction: 'none' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[cx + 100, 250, 150]} intensity={1.1} />
      <OrbitControls target={[cx, S / 2, cz]} makeDefault />
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
        const edit = p.kind === 'block'
        const id = `p${i}`
        return (
          <Box
            key={i}
            p={p}
            color={hover?.id === id ? '#e57373' : COLORS[p.kind] ?? '#999'}
            opacity={layer.opacity}
            onOver={edit ? () => setHover({ id, kind: 'block', delta: -1, pos: [p.x + p.sx / 2, p.z + p.sz + 0.5, -(p.y + p.sy / 2)] }) : undefined}
            onOut={edit ? leave : undefined}
          />
        )
      })}
      {voids.filter((v) => L[v.kind === 'joist' ? 'joists' : 'cross'].visible).map((v) => (
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
          <button
            className={hover.delta > 0 ? 'jbtn add' : 'jbtn del'}
            title={hover.delta > 0 ? 'Add support here' : 'Delete this support'}
            onPointerEnter={keep}
            onPointerLeave={leave}
            onClick={() => act(hover)}
          >
            {hover.delta > 0 ? '+' : '−'}
          </button>
        </Html>
      )}
      {opts.loadMap &&
        L.deck.visible &&
        build.layout.cells.map((c) => {
          if (build.params.features.hatches && c.type === 'bin') return null
          const st = status.get(c.index) ?? 'ok'
          const pl: Placement = { kind: 'deck', x: c.x, y: c.y, z: S + ply + 0.05, sx: c.w, sy: c.l, sz: 0.05 }
          return <Box key={`lm${c.index}`} p={pl} color={STATUS_COLOR[st]} opacity={0.8} />
        })}
      {L.tatami.visible &&
        mats.map((m, i) => {
          const pl: Placement = { kind: 'bin', x: m.x + 0.1, y: m.y + 0.1, z: S + ply, sx: m.w - 0.2, sy: m.l - 0.2, sz: build.params.tatamiThickness }
          return <Box key={`m${i}`} p={pl} color={m.kind === 'cut' ? '#d9c27a' : '#b7c78a'} opacity={L.tatami.opacity} />
        })}
    </Canvas>
    </div>
  )
}
