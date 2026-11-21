import type { FloorSpec, Pt, Rect } from './types'

export type Side = 'front' | 'back' | 'left' | 'right'

export interface PolyEdge {
  /** index of the edge in the user's polygon (edge i runs from vertex i to i+1) */
  index: number
  side: Side
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  isFront: boolean
}

export interface FloorGeometry {
  /** counter-clockwise, rotated so the front edge faces -y, min corner at the origin */
  poly: Pt[]
  rects: Rect[]
  edges: PolyEdge[]
  width: number
  length: number
  front: { y: number; x1: number; x2: number } | null
  area: number
  error?: string
}

const EPS = 1e-6

export function floorPolygon(f: FloorSpec): Pt[] {
  if (f.shape === 'poly') return (f.poly ?? []).map((p) => ({ ...p }))
  if (f.shape === 'L' && f.notchW > 0 && f.notchL > 0 && f.notchW < f.width && f.notchL < f.length) {
    const lowerL = f.length - f.notchL
    const upperW = f.width - f.notchW
    return [
      { x: 0, y: 0 },
      { x: f.width, y: 0 },
      { x: f.width, y: lowerL },
      { x: upperW, y: lowerL },
      { x: upperW, y: f.length },
      { x: 0, y: f.length },
    ]
  }
  return [
    { x: 0, y: 0 },
    { x: f.width, y: 0 },
    { x: f.width, y: f.length },
    { x: 0, y: f.length },
  ]
}

export function signedArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function orient(a: Pt, b: Pt, c: Pt) {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  return Math.abs(v) < EPS ? 0 : v > 0 ? 1 : -1
}
function onSeg(a: Pt, b: Pt, c: Pt) {
  return Math.min(a.x, b.x) - EPS <= c.x && c.x <= Math.max(a.x, b.x) + EPS && Math.min(a.y, b.y) - EPS <= c.y && c.y <= Math.max(a.y, b.y) + EPS
}
function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt) {
  const o1 = orient(a, b, c)
  const o2 = orient(a, b, d)
  const o3 = orient(c, d, a)
  const o4 = orient(c, d, b)
  if (o1 !== o2 && o3 !== o4) return true
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b))
}

/** Returns an error message, or undefined when the polygon is a usable right-angled shape. */
export function validatePolygon(poly: Pt[]): string | undefined {
  const n = poly.length
  if (n < 4) return 'Shape needs at least 4 corners.'
  if (n % 2 !== 0) return 'A right-angled shape has an even number of corners.'
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    if (dx > EPS && dy > EPS) return `Edge ${i + 1} is slanted; only right-angled shapes are supported.`
    if (dx + dy < 1) return `Edge ${i + 1} is shorter than 1 inch.`
  }
  if (Math.abs(signedArea(poly)) < 1) return 'Shape has no area.'
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue
      if (segmentsTouch(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return `Edges ${i + 1} and ${j + 1} cross or touch.`
    }
  }
  return undefined
}

/** Change the length of edge i by sliding the next two corners, so the shape stays right-angled. */
export function setEdgeLength(poly: Pt[], i: number, len: number): Pt[] {
  const n = poly.length
  const a = poly[i]
  const b = poly[(i + 1) % n]
  const horizontal = Math.abs(b.y - a.y) < EPS
  const cur = horizontal ? b.x - a.x : b.y - a.y
  const sign = cur < 0 ? -1 : 1
  const delta = sign * len - cur
  const out = poly.map((p) => ({ ...p }))
  for (const k of [(i + 1) % n, (i + 2) % n]) {
    if (horizontal) out[k].x += delta
    else out[k].y += delta
  }
  return out
}

const rot = (p: Pt, d: Pt): Pt => {
  if (d.x === 1) return p
  if (d.y === 1) return { x: p.y, y: -p.x }
  if (d.x === -1) return { x: -p.x, y: -p.y }
  return { x: -p.y, y: p.x }
}

function decompose(poly: Pt[]): Rect[] {
  const xs = [...new Set(poly.map((p) => Math.round(p.x * 1000) / 1000))].sort((a, b) => a - b)
  const hEdges: { x0: number; x1: number; y: number }[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (Math.abs(a.y - b.y) < EPS) hEdges.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y: a.y })
  }
  const rects: Rect[] = []
  for (let k = 0; k < xs.length - 1; k++) {
    const xa = xs[k]
    const xb = xs[k + 1]
    const mid = (xa + xb) / 2
    const ys = hEdges.filter((e) => e.x0 < mid && mid < e.x1).map((e) => e.y).sort((a, b) => a - b)
    for (let m = 0; m + 1 < ys.length; m += 2) {
      const y0 = ys[m]
      const y1 = ys[m + 1]
      const open = rects.find((r) => Math.abs(r.y - y0) < EPS && Math.abs(r.l - (y1 - y0)) < EPS && Math.abs(r.x + r.w - xa) < EPS)
      if (open) open.w += xb - xa
      else rects.push({ x: xa, y: y0, w: xb - xa, l: y1 - y0 })
    }
  }
  return rects
}

const EMPTY: FloorGeometry = { poly: [], rects: [], edges: [], width: 0, length: 0, front: null, area: 0 }

export function normalizeFloor(f: FloorSpec): FloorGeometry {
  let poly = floorPolygon(f)
  const err = validatePolygon(poly)
  if (err) {
    const w = poly.length ? Math.max(...poly.map((p) => p.x)) - Math.min(...poly.map((p) => p.x)) : 0
    const l = poly.length ? Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y)) : 0
    return { ...EMPTY, poly, width: w, length: l, error: err }
  }
  const n = poly.length
  let front = Math.min(Math.max(0, Math.round(f.frontEdge ?? 0)), n - 1)
  if (signedArea(poly) < 0) {
    poly = [poly[0], ...poly.slice(1).reverse()]
    front = n - 1 - front
  }
  const a = poly[front]
  const b = poly[(front + 1) % n]
  const d = { x: Math.sign(Math.round((b.x - a.x) * 1000)), y: Math.sign(Math.round((b.y - a.y) * 1000)) }
  poly = poly.map((p) => rot(p, d))
  const minX = Math.min(...poly.map((p) => p.x))
  const minY = Math.min(...poly.map((p) => p.y))
  poly = poly.map((p) => ({ x: Math.round((p.x - minX) * 1000) / 1000, y: Math.round((p.y - minY) * 1000) / 1000 }))

  const edges: PolyEdge[] = poly.map((p, i) => {
    const q = poly[(i + 1) % n]
    const dx = Math.sign(Math.round((q.x - p.x) * 1000))
    const dy = Math.sign(Math.round((q.y - p.y) * 1000))
    const side: Side = dx === 1 ? 'front' : dx === -1 ? 'back' : dy === 1 ? 'right' : 'left'
    return { index: i, side, x1: p.x, y1: p.y, x2: q.x, y2: q.y, length: Math.abs(q.x - p.x) + Math.abs(q.y - p.y), isFront: i === front }
  })
  const fe = edges[front]
  const rects = decompose(poly)
  return {
    poly,
    rects,
    edges,
    width: Math.max(...poly.map((p) => p.x)),
    length: Math.max(...poly.map((p) => p.y)),
    front: { y: fe.y1, x1: Math.min(fe.x1, fe.x2), x2: Math.max(fe.x1, fe.x2) },
    area: rects.reduce((s, r) => s + r.w * r.l, 0),
  }
}
