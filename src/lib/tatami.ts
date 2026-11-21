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
  score: number
}

const PATTERNS: { id: TatamiPatternId; label: string; description: string }[] = [
  { id: 'rows', label: 'Straight rows', description: 'All 72x36 mats laid long-side along the width, in aligned rows.' },
  { id: 'columns', label: 'Straight columns', description: 'All 72x36 mats laid long-side along the length.' },
  { id: 'brick', label: 'Brick (staggered rows)', description: 'Rows alternate, offset with a square mat - T-joints only, the traditional rule.' },
  { id: 'brickV', label: 'Brick (staggered columns)', description: 'Same staggered pattern turned 90 degrees.' },
  { id: 'basket', label: 'Basket weave', description: '72x72 blocks alternating horizontal / vertical pairs.' },
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
  }
}

function tile(rects: Rect[], id: TatamiPatternId, L: number, S: number): Mat[] {
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

export function suggestTatami(rects: Rect[], p: Pick<Params, 'tatamiLong' | 'tatamiShort'>): TatamiArrangement[] {
  if (!rects.length) return []
  const L = p.tatamiLong
  const S = p.tatamiShort
  const total = rects.reduce((s, r) => s + r.w * r.l, 0)
  const out: TatamiArrangement[] = PATTERNS.map((pat) => {
    const mats = tile(rects, pat.id, L, S)
    const counts = { full: 0, square: 0, cut: 0 }
    let cutArea = 0
    for (const m of mats) {
      counts[m.kind]++
      if (m.kind === 'cut') cutArea += m.w * m.l
    }
    const fourCorner = countFourCorners(mats)
    const cutAreaPct = (cutArea / total) * 100
    const score = counts.cut * 100 + cutAreaPct + fourCorner * 30
    return { ...pat, mats, counts, cutAreaPct, fourCorner, score }
  })
  return out.sort((a, b) => a.score - b.score)
}

export function matSchedule(mats: Mat[]): { name: string; w: number; l: number; qty: number }[] {
  const m = new Map<string, { name: string; w: number; l: number; qty: number }>()
  for (const mat of mats) {
    const w = Math.max(mat.w, mat.l)
    const l = Math.min(mat.w, mat.l)
    const name = mat.kind === 'cut' ? 'Custom-cut mat' : mat.kind === 'full' ? 'Full mat' : 'Square mat'
    const k = `${name}|${w}|${l}`
    const e = m.get(k)
    if (e) e.qty++
    else m.set(k, { name, w, l, qty: 1 })
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name) || b.w * b.l - a.w * a.l)
}
