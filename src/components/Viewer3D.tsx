import { Canvas } from '@react-three/fiber'
import { Edges, OrbitControls } from '@react-three/drei'
import type { Build } from '../lib/build'
import type { Structural, Status } from '../lib/structural'
import type { Mat } from '../lib/tatami'
import type { Placement } from '../lib/types'

export interface ViewOptions {
  deck: boolean
  tatami: boolean
  bins: boolean
  loadMap: boolean
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
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      <Edges color="#3b2a14" threshold={15} />
    </mesh>
  )
}

export function Viewer3D({ build, structural, mats, opts }: { build: Build; structural: Structural; mats: Mat[]; opts: ViewOptions }) {
  const f = build.params.floor
  const cx = f.width / 2
  const cz = -f.length / 2
  const span = Math.max(f.width, f.length, 60)
  const S = build.supportHeight
  const ply = build.params.plyThickness
  const status = new Map(structural.cells.map((c) => [c.cell, c.status]))

  return (
    <Canvas camera={{ position: [cx + span * 0.6, span * 0.9, cz + span * 1.2], fov: 45, near: 1, far: 5000 }} style={{ touchAction: 'none' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[cx + 100, 250, 150]} intensity={1.1} />
      <OrbitControls target={[cx, S / 2, cz]} makeDefault />
      <gridHelper args={[span * 2.5, 20, '#888', '#ccc']} position={[cx, -0.05, cz]} />
      {build.placements.map((p, i) => {
        if (p.kind === 'deck' && !opts.deck) return null
        if (p.kind === 'hatch' && !opts.deck) return null
        if (p.kind === 'bin' && !opts.bins) return null
        if (p.kind === 'deck') return <Box key={i} p={p} color={COLORS.deck} opacity={opts.tatami ? 0.95 : 0.6} />
        if (p.kind === 'hatch') {
          const st = p.cell !== undefined ? status.get(p.cell) : undefined
          return <Box key={i} p={p} color={opts.loadMap && st ? STATUS_COLOR[st] : COLORS.hatch} />
        }
        return <Box key={i} p={p} color={COLORS[p.kind] ?? '#999'} />
      })}
      {opts.loadMap &&
        build.layout.cells.map((c) => {
          if (build.params.features.hatches && c.type === 'bin') return null
          const st = status.get(c.index) ?? 'ok'
          const pl: Placement = { kind: 'deck', x: c.x, y: c.y, z: S + ply + 0.05, sx: c.w, sy: c.l, sz: 0.05 }
          return <Box key={`lm${c.index}`} p={pl} color={STATUS_COLOR[st]} opacity={0.8} />
        })}
      {opts.tatami &&
        mats.map((m, i) => {
          const pl: Placement = { kind: 'bin', x: m.x + 0.1, y: m.y + 0.1, z: S + ply, sx: m.w - 0.2, sy: m.l - 0.2, sz: build.params.tatamiThickness }
          return <Box key={`m${i}`} p={pl} color={m.kind === 'cut' ? '#d9c27a' : '#b7c78a'} />
        })}
    </Canvas>
  )
}
