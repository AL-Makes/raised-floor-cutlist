import type { Layout } from './layout'
import type { Rect } from './types'

/**
 * Plywood deck planner.
 * Rules: panels are cut from sheets of plywood (default 4x8 ft) with as few cuts as possible; a panel edge always
 * lands on a joist / cross-block centreline, except at the floor edge where the panel covers the rim and runs out
 * to the edge. Under tatami mats the panels are lift-out; under filler pieces they are fixed (or, by choice, lift out
 * as a service panel).
 */

/** Split [0,length] into spans <= max, preferring cuts that land on a support centre. */
export function splitAxis(length: number, centers: number[], first: number, max: number) {
  const cuts: number[] = []
  const unsupported: number[] = []
  let pos = 0
  let limit = first
  let guard = 0
  while (guard++ < 1000) {
    if (length - pos <= limit + 1e-9) {
      cuts.push(length)
      break
    }
    const target = pos + limit
    const cands = centers.filter((c) => c > pos + 6 && c <= target + 1e-9)
    let cut = target
    if (cands.length) cut = Math.max(...cands)
    else {
      // never cut over thin air: run on to the next support (the oversize piece is flagged by the sheet check)
      const beyond = centers.filter((c) => c > target && c < length - 6)
      if (beyond.length) cut = Math.min(...beyond)
      else {
        unsupported.push(target)
        cuts.push(length)
        break
      }
    }
    cuts.push(cut)
    pos = cut
    limit = max
  }
  return { cuts, unsupported }
}

export interface DeckPiece {
  x: number
  y: number
  w: number
  l: number
}

/** Split a rect at a plan coordinate (x or y), if the cut is inside it. */
export function splitAt(r: Rect, axis: 'x' | 'y', pos: number): Rect[] {
  if (axis === 'x') {
    if (pos <= r.x + 0.5 || pos >= r.x + r.w - 0.5) return [r]
    return [{ ...r, w: pos - r.x }, { ...r, x: pos, w: r.x + r.w - pos }]
  }
  if (pos <= r.y + 0.5 || pos >= r.y + r.l - 0.5) return [r]
  return [{ ...r, l: pos - r.y }, { ...r, y: pos, l: r.y + r.l - pos }]
}

/**
 * Cut a w x l rectangle of deck into the fewest panels (each liftable on its own), seams on supports.
 * Tries the sheet's long side across and along the joists and keeps whichever needs fewer pieces.
 */
export function planDeck(w: number, l: number, xCenters: number[], yCenters: number[], sheetL: number, sheetW: number) {
  const attempt = (longAcross: boolean) => {
    const maxX = longAcross ? sheetL : sheetW
    const maxY = longAcross ? sheetW : sheetL
    const sx = splitAxis(w, xCenters, maxX, maxX)
    const sy = splitAxis(l, yCenters, maxY, maxY)
    const pieces: DeckPiece[] = []
    let y0 = 0
    for (const y1 of sy.cuts) {
      let x0 = 0
      for (const x1 of sx.cuts) {
        pieces.push({ x: x0, y: y0, w: x1 - x0, l: y1 - y0 })
        x0 = x1
      }
      y0 = y1
    }
    const unsupported = [
      ...sx.unsupported.map((pos) => ({ axis: 'x' as const, pos })),
      ...sy.unsupported.map((pos) => ({ axis: 'y' as const, pos })),
    ]
    return { pieces, unsupported, score: pieces.length * 10 + unsupported.length }
  }
  const a = attempt(true)
  const b = attempt(false)
  return b.score < a.score ? b : a
}

export type DeckKind = 'accessible' | 'fixed' | 'lift'
export interface DeckPanel extends Rect {
  kind: DeckKind
  section: number
}

const overlap = (a: Rect, b: Rect) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.l, b.y + b.l) - Math.max(a.y, b.y) > 0.5

export function planPlywood(layout: Layout, o: { sheetL: number; sheetW: number; serviceFillers: number[] }) {
  const panels: DeckPanel[] = []
  const unsupported: { axis: 'x' | 'y'; pos: number; section: number }[] = []
  const T = layout.joistW
  // slivers (floor not a whole number of mats) get no plywood of their own; fillers stacked edge to edge merge into one zone
  const groups: { r: Rect; idx: number[] }[] = []
  layout.fillers.forEach((f, i) => {
    if (f.w < 6 || f.l < 6) return
    const svc = o.serviceFillers.includes(i)
    const g = groups.find((g) => g.idx.some((k) => o.serviceFillers.includes(k)) === svc &&
        ((Math.abs(g.r.x - f.x) < 0.5 && Math.abs(g.r.w - f.w) < 0.5 && Math.abs(g.r.y + g.r.l - f.y) < 0.5) || (Math.abs(g.r.y - f.y) < 0.5 && Math.abs(g.r.l - f.l) < 0.5 && Math.abs(g.r.x + g.r.w - f.x) < 0.5)),
    )
    if (g) {
      g.r = { x: g.r.x, y: g.r.y, w: Math.max(g.r.x + g.r.w, f.x + f.w) - g.r.x, l: Math.max(g.r.y + g.r.l, f.y + f.l) - g.r.y }
      g.idx.push(i)
    } else groups.push({ r: { ...f }, idx: [i] })
  })
  const rawFillers = groups.map((g) => g.r)

  for (const sec of layout.sections) {
    const { rect } = sec
    const xs = sec.joistX.map((x, k) => x + sec.joistT[k] / 2)
    // a seam across several bays needs a cross joist in every one of them, so only shared lines count
    const shared = sec.blockY.filter((y) => sec.colBlocks.every((cb) => cb.some((v) => Math.abs(v - y) < 0.01)))
    const ys = [rect.y + T / 2, ...shared.map((y) => y + T / 2), rect.y + rect.l - T / 2]

    // a filler whose edge has no joist under it grows out to the nearest joist, so seams never fall over thin air and no area is left uncovered
    const snap = (lo: number, hi: number, cs: number[], a: number, b: number) => {
      const c = [...cs, a, b]
      const s0 = Math.max(...c.filter((v) => v <= lo + 0.5), a)
      const s1 = Math.min(...c.filter((v) => v >= hi - 0.5), b)
      return [Math.max(a, Math.min(s0, lo)), Math.min(b, Math.max(s1, hi))]
    }
    const fillers = rawFillers.map((f) => {
      if (!overlap(f, rect)) return f
      const [x0, x1] = snap(f.x, f.x + f.w, xs, rect.x, rect.x + rect.w)
      const [y0, y1] = snap(f.y, f.y + f.l, ys, rect.y, rect.y + rect.l)
      return { x: x0, y: y0, w: x1 - x0, l: y1 - y0 }
    })

    /** tile one zone into the fewest sheet pieces, seams on the section's supports */
    const tile = (z: Rect) => {
      const plan = planDeck(
        z.w,
        z.l,
        xs.map((c) => c - z.x),
        ys.map((c) => c - z.y),
        o.sheetL,
        o.sheetW,
      )
      for (const u of plan.unsupported) unsupported.push({ axis: u.axis, pos: u.axis === 'x' ? z.x + u.pos : z.y + u.pos, section: sec.index })
      return plan.pieces.map((pc) => ({ x: z.x + pc.x, y: z.y + pc.y, w: pc.w, l: pc.l }))
    }
    const onSupport = (axis: 'x' | 'y', pos: number) =>
      (axis === 'x' ? xs : ys).some((c) => Math.abs(c - pos) < T) || Math.abs(pos - (axis === 'x' ? rect.x : rect.y)) < 0.5 || Math.abs(pos - (axis === 'x' ? rect.x + rect.w : rect.y + rect.l)) < 0.5
    const underFiller = (r: Rect) => {
      const cx = r.x + r.w / 2
      const cy = r.y + r.l / 2
      return fillers.some((f) => cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.l)
    }

    // 1. the mat area: lift-out panels, with the drawer front row planned on its own
    if (!sec.fixed) {
      const cutY = sec.drawerFront && shared.length ? shared[0] + T / 2 - rect.y : 0
      const regions: Rect[] = cutY > 0
        ? [{ x: rect.x, y: rect.y, w: rect.w, l: cutY }, { x: rect.x, y: rect.y + cutY, w: rect.w, l: rect.l - cutY }]
        : [rect]
      for (const reg of regions) {
        for (const pc of tile(reg)) {
          let parts: Rect[] = [pc]
          for (const f of fillers) {
            if (!overlap(pc, f)) continue
            for (const [axis, pos] of [['x', f.x], ['x', f.x + f.w], ['y', f.y], ['y', f.y + f.l]] as const)
              if (onSupport(axis, pos)) parts = parts.flatMap((r) => (overlap(r, f) ? splitAt(r, axis, pos) : [r]))
          }
          for (const r of parts) if (!underFiller(r)) panels.push({ ...r, kind: 'accessible', section: sec.index })
        }
      }
    }

    // 2. under the fillers: fixed panels the size of the filler (or shared sheets when the whole section is filler)
    const touching = fillers
      .map((f, fi) => ({ f, fi }))
      .filter(({ f }) => overlap(f, rect))
      .map(({ f, fi }) => {
        const x0 = Math.max(f.x, rect.x)
        const y0 = Math.max(f.y, rect.y)
        return { fi, z: { x: x0, y: y0, w: Math.min(f.x + f.w, rect.x + rect.w) - x0, l: Math.min(f.y + f.l, rect.y + rect.l) - y0 } as Rect }
      })
    if (!touching.length) continue
    const area = touching.reduce((s, t) => s + t.z.w * t.z.l, 0)
    const wholeSection = area > rect.w * rect.l * 0.95
    const anyService = touching.some((t) => groups[t.fi].idx.some((i) => o.serviceFillers.includes(i)))

    if (wholeSection && !anyService) {
      for (const r of tile(rect)) panels.push({ ...r, kind: 'fixed', section: sec.index })
      continue
    }
    for (const { fi, z } of touching) {
      const pieces = tile(z)
      if (!groups[fi].idx.some((i) => o.serviceFillers.includes(i))) {
        for (const r of pieces) panels.push({ ...r, kind: 'fixed', section: sec.index })
        continue
      }
      // service filler: one panel per sheet piece lifts out; a single piece with a joist inside is cut on the joist nearest its middle
      if (pieces.length === 1) {
        const tr = pieces[0]
        const cands = [
          ...xs.slice(1, -1).map((pos) => ({ axis: 'x' as const, pos })).filter((c) => c.pos > tr.x + 6 && c.pos < tr.x + tr.w - 6),
          ...ys.slice(1, -1).map((pos) => ({ axis: 'y' as const, pos })).filter((c) => c.pos > tr.y + 6 && c.pos < tr.y + tr.l - 6),
        ]
        const mid = (c: { axis: 'x' | 'y'; pos: number }) => Math.abs(c.pos - (c.axis === 'x' ? tr.x + tr.w / 2 : tr.y + tr.l / 2))
        const best = cands.sort((a, b) => mid(a) - mid(b))[0]
        if (best) {
          const halves = splitAt(tr, best.axis, best.pos)
          const small = halves[0].w * halves[0].l <= halves[1].w * halves[1].l ? 0 : 1
          halves.forEach((h, k) => panels.push({ ...h, kind: k === small ? 'lift' : 'fixed', section: sec.index }))
          continue
        }
      }
      for (const r of pieces) panels.push({ ...r, kind: 'lift', section: sec.index })
    }
  }
  return { panels, unsupported }
}
