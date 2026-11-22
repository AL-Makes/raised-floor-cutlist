import type { Params, Rect, TatamiPatternId } from './types'

export const RES = 0.5

export interface Mat {
  x: number
  y: number
  w: number
  l: number
  kind: 'full' | 'square' | 'cut'
}

export interface TatamiArrangement {
  id: TatamiPatternId
  label: string
  description: string
  mats: Mat[]
  counts: { full: number; square: number; cut: number }
  cutAreaPct: number
  fourCorner: number
  /** no four-corner crossings: shugi-jiki (auspicious) rather than fushugi-jiki (grid) */
  auspicious: boolean
  score: number
}

const PATTERNS: { id: TatamiPatternId; label: string; description: string }[] = [
  { id: 'rows', label: 'Straight rows', description: 'All 72x36 mats laid long-side along the width, in aligned rows.' },
  { id: 'columns', label: 'Straight columns', description: 'All 72x36 mats laid long-side along the length.' },
  { id: 'brick', label: 'Brick (staggered rows)', description: 'Rows alternate, offset with a square mat - T-joints only, the traditional rule.' },
  { id: 'brickV', label: 'Brick (staggered columns)', description: 'Same staggered pattern turned 90 degrees.' },
  { id: 'basket', label: 'Basket weave', description: '72x72 blocks alternating horizontal / vertical pairs.' },
  { id: 'pinwheel', label: 'Pinwheel (shugi-jiki)', description: 'Four mats spiral round a half (square) mat: only T-junctions, the auspicious layout.' },
  { id: 'squares', label: 'All squares', description: 'Only 36x36 mats on a grid.' },
]

interface Grid {
  nx: number
  ny: number
  free: Uint8Array
}

function makeGrid(rects: Rect[]): Grid {
  const w = Math.max(...rects.map((r) => r.x + r.w))
  const l = Math.max(...rects.map((r) => r.y + r.l))
  const nx = Math.round(w / RES)
  const ny = Math.round(l / RES)
  const free = new Uint8Array(nx * ny)
  for (const r of rects) {
    for (let j = Math.round(r.y / RES); j < Math.round((r.y + r.l) / RES); j++)
      for (let i = Math.round(r.x / RES); i < Math.round((r.x + r.w) / RES); i++) free[j * nx + i] = 1
  }
  return { nx, ny, free }
}

function transposeRects(rects: Rect[]): Rect[] {
  return rects.map((r) => ({ x: r.y, y: r.x, w: r.l, l: r.w }))
}

type Pref = (x: number, y: number) => [number, number][]

function prefFor(id: TatamiPatternId, L: number, S: number): Pref {
  switch (id) {
    case 'rows':
    case 'columns':
      return () => [[L, S], [S, S]]
    case 'brick':
    case 'brickV':
      return (x, y) => {
        const row = Math.floor(y / S + 1e-6)
        return row % 2 === 1 && x < RES / 2 ? [[S, S], [L, S]] : [[L, S], [S, S]]
      }
    case 'basket':
      return (x, y) => {
        const bx = Math.floor(x / L + 1e-6)
        const by = Math.floor(y / L + 1e-6)
        return (bx + by) % 2 === 0 ? [[L, S], [S, L], [S, S]] : [[S, L], [L, S], [S, S]]
      }
    case 'squares':
      return () => [[S, S]]
    case 'pinwheel': {
      const T = L + S
      const starts: [number, number, [number, number]][] = [
        [0, 0, [L, S]],
        [L, 0, [S, L]],
        [S, L, [L, S]],
        [0, S, [S, L]],
        [S, S, [S, S]],
      ]
      return (x, y) => {
        const row = Math.floor(y / T + 1e-6)
        const lx = (((x - (T / 2) * row) % T) + T) % T
        const ly = y % T
        const hit = starts.find(([sx, sy]) => Math.abs(sx - lx) < 1e-6 && Math.abs(sy - ly) < 1e-6)
        return hit ? [hit[2], [L, S], [S, L], [S, S]] : [[L, S], [S, S]]
      }
    }
  }
}

/** True when at least one S x S mat fits entirely inside the floor. */
export function tatamiFit(rects: Rect[], S: number): boolean {
  if (!rects.length) return false
  const g = makeGrid(rects)
  const k = Math.round(S / RES)
  const W = g.nx + 1
  const I = new Int32Array(W * (g.ny + 1))
  for (let j = 0; j < g.ny; j++)
    for (let i = 0; i < g.nx; i++)
      I[(j + 1) * W + i + 1] = g.free[j * g.nx + i] + I[j * W + i + 1] + I[(j + 1) * W + i] - I[j * W + i]
  for (let j = 0; j + k <= g.ny; j++)
    for (let i = 0; i + k <= g.nx; i++) {
      const s = I[(j + k) * W + i + k] - I[j * W + i + k] - I[(j + k) * W + i] + I[j * W + i]
      if (s === k * k) return true
    }
  return false
}

export const TATAMI_FIT_MESSAGE = 'Flooring size not large enough to accommodate at least one tatami mat.'

export type TatamiAnchor = 'bl' | 'br' | 'tl' | 'tr' | 'center'

function tile(rects: Rect[], id: TatamiPatternId, L: number, S: number, anchor: TatamiAnchor = 'bl'): Mat[] {
  if (anchor === 'bl') return tileRaw(rects, id, L, S)
  const W = Math.max(...rects.map((r) => r.x + r.w))
  const H = Math.max(...rects.map((r) => r.y + r.l))
  if (anchor === 'center') {
    const rx = W % S
    const ry = H % S
    const sx = rx < 0.01 || S - rx < 0.01 ? 0 : S - rx / 2
    const sy = ry < 0.01 || S - ry < 0.01 ? 0 : S - ry / 2
    const shifted = rects.map((r) => ({ x: r.x + sx, y: r.y + sy, w: r.w, l: r.l }))
    const box: Rect = { x: 0, y: 0, w: W + sx + L, l: H + sy + L }
    const out: Mat[] = []
    for (const m of tileRaw([box], id, L, S)) {
      for (const r of shifted) {
        const x0 = Math.max(m.x, r.x)
        const y0 = Math.max(m.y, r.y)
        const x1 = Math.min(m.x + m.w, r.x + r.w)
        const y1 = Math.min(m.y + m.l, r.y + r.l)
        if (x1 - x0 < RES / 2 || y1 - y0 < RES / 2) continue
        const whole = Math.abs(x1 - x0 - m.w) < 0.01 && Math.abs(y1 - y0 - m.l) < 0.01
        out.push({ x: x0 - sx, y: y0 - sy, w: x1 - x0, l: y1 - y0, kind: whole ? m.kind : 'cut' })
      }
    }
    return out
  }
  const fx = anchor === 'br' || anchor === 'tr'
  const fy = anchor === 'tl' || anchor === 'tr'
  const mirrored = rects.map((r) => ({ x: fx ? W - r.x - r.w : r.x, y: fy ? H - r.y - r.l : r.y, w: r.w, l: r.l }))
  return tileRaw(mirrored, id, L, S).map((m) => ({ ...m, x: fx ? W - m.x - m.w : m.x, y: fy ? H - m.y - m.l : m.y }))
}

function tileRaw(rects: Rect[], id: TatamiPatternId, L: number, S: number): Mat[] {
  const transpose = id === 'columns' || id === 'brickV'
  const useRects = transpose ? transposeRects(rects) : rects
  const g = makeGrid(useRects)
  const pref = prefFor(id, L, S)
  const mats: Mat[] = []

  const fits = (i: number, j: number, wc: number, hc: number) => {
    if (i + wc > g.nx || j + hc > g.ny) return false
    for (let b = j; b < j + hc; b++) for (let a = i; a < i + wc; a++) if (!g.free[b * g.nx + a]) return false
    return true
  }
  const fill = (i: number, j: number, wc: number, hc: number) => {
    for (let b = j; b < j + hc; b++) for (let a = i; a < i + wc; a++) g.free[b * g.nx + a] = 0
  }

  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      if (!g.free[j * g.nx + i]) continue
      const x = i * RES
      const y = j * RES
      const prefs = pref(x, y)
      let placed = false
      for (const [w, h] of prefs) {
        const wc = Math.round(w / RES)
        const hc = Math.round(h / RES)
        if (fits(i, j, wc, hc)) {
          fill(i, j, wc, hc)
          mats.push({ x, y, w, l: h, kind: w === L && h === S || w === S && h === L ? 'full' : 'square' })
          placed = true
          break
        }
      }
      if (placed) continue
      const [pw, ph] = prefs[0]
      let rw = 0
      while (rw < Math.round(pw / RES) && i + rw < g.nx && g.free[j * g.nx + i + rw]) rw++
      let rh = 0
      outer: while (rh < Math.round(ph / RES) && j + rh < g.ny) {
        for (let a = 0; a < rw; a++) if (!g.free[(j + rh) * g.nx + i + a]) break outer
        rh++
      }
      fill(i, j, rw, rh)
      mats.push({ x, y, w: rw * RES, l: rh * RES, kind: 'cut' })
    }
  }
  return transpose ? mats.map((m) => ({ x: m.y, y: m.x, w: m.l, l: m.w, kind: m.kind })) : mats
}

function countFourCorners(mats: Mat[]): number {
  const pts = new Map<string, number>()
  const key = (x: number, y: number) => `${Math.round(x / RES)},${Math.round(y / RES)}`
  for (const m of mats) {
    for (const [cx, cy] of [
      [m.x, m.y],
      [m.x + m.w, m.y],
      [m.x, m.y + m.l],
      [m.x + m.w, m.y + m.l],
    ]) {
      const k = key(cx, cy)
      pts.set(k, (pts.get(k) ?? 0) + 1)
    }
  }
  let n = 0
  for (const v of pts.values()) if (v >= 4) n++
  return n
}

export function suggestTatami(rects: Rect[], p: Pick<Params, 'tatamiLong' | 'tatamiShort'> & { tatamiAnchor?: TatamiAnchor }): TatamiArrangement[] {
  if (!rects.length || !tatamiFit(rects, p.tatamiShort)) return []
  const L = p.tatamiLong
  const S = p.tatamiShort
  const total = rects.reduce((s, r) => s + r.w * r.l, 0)
  const out: TatamiArrangement[] = PATTERNS.map((pat) => {
    const mats =     tile(rects, pat.id, L, S, p.tatamiAnchor ?? 'bl')
    const counts = { full: 0, square: 0, cut: 0 }
    let cutArea = 0
    for (const m of mats) {
      counts[m.kind]++
      if (m.kind === 'cut') cutArea += m.w * m.l
    }
    const fourCorner = countFourCorners(mats)
    const cutAreaPct = (cutArea / total) * 100
    const score = counts.cut * 100 + cutAreaPct + fourCorner * 30
    return { ...pat, mats, counts, cutAreaPct, fourCorner, auspicious: fourCorner === 0, score }
  })
  return out.sort((a, b) => a.score - b.score)
}

export function matSchedule(mats: Mat[]): { name: string; w: number; l: number; qty: number }[] {
  const m = new Map<string, { name: string; w: number; l: number; qty: number }>()
  for (const mat of mats) {
    const w = Math.max(mat.w, mat.l)
    const l = Math.min(mat.w, mat.l)
    const name = mat.kind === 'cut' ? 'Plywood filler piece (fixed, tatami height)' : mat.kind === 'full' ? 'Full mat' : 'Square mat'
    const k = `${name}|${w}|${l}`
    const e = m.get(k)
    if (e) e.qty++
    else m.set(k, { name, w, l, qty: 1 })
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name) || b.w * b.l - a.w * a.l)
}





