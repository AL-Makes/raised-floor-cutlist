import { Canvas } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import type { Build } from '../lib/build'
import type { Structural, Status } from '../lib/structural'
import type { Mat } from '../lib/tatami'
import type { Placement } from '../lib/types'

export type LayerKey = 'frame' | 'side' | 'deck' | 'tatami' | 'bins' | 'drawers'
export interface Layer {
  visible: boolean
  opacity: number
}
export interface ViewOptions {
  layers: Record<LayerKey, Layer>
  loadMap: boolean
}

export const LAYER_LABELS: Record<LayerKey, string> = {
  frame: 'Joists & supports',
  side: 'Side panels / trim / drawer faces',
  deck: 'Plywood layer',
  tatami: 'Tatami layer',
  bins: 'Bins',
  drawers: 'Drawer boxes',
}

export const defaultView = (): ViewOptions => ({
  layers: {
    frame: { visible: true, opacity: 1 },
    side: { visible: true, opacity: 1 },
    deck: { visible: true, opacity: 0.6 },
    tatami: { visible: false, opacity: 1 },
    bins: { visible: true, opacity: 1 },
    drawers: { visible: true, opacity: 1 },
  },
  loadMap: false,
})

function layerOf(kind: string): LayerKey {
  if (kind === 'deck' || kind === 'hatch') return 'deck'
  if (kind === 'trim' || kind === 'drawerFace') return 'side'
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
}

const STATUS_COLOR: Record<Status, string> = { ok: '#2ecc71', warn: '#f1c40f', fail: '#e74c3c' }

function Box({ p, color, opacity = 1 }: { p: Placement; color: string; opacity?: number }) {
  return (
    <mesh position={[p.x + p.sx / 2, p.z + p.sz / 2, -(p.y + p.sy / 2)]}>
      <boxGeometry args={[p.sx, p.sz, p.sy]} />
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
      <Edges color="#3b2a14" threshold={15} />
    </mesh>
  )
}

export function Viewer3D({ build, structural, mats, opts }: { build: Build; structural: Structural; mats: Mat[]; opts: ViewOptions }) {
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
        return <Box key={i} p={p} color={COLORS[p.kind] ?? '#999'} opacity={layer.opacity} />
      })}
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
  )
}
