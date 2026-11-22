import { normalizeFloor } from './geometry'
import { fillerRects } from './tatami'
import type { Cell, Params, Rect } from './types'

export const RIM_T = 1.5
/** Built-up joist: two 2x4 chords laid flat (top + bottom) with vertical 2x4 webs between them, so it is 3-1/2" wide. */
export const BUILTUP_W = 3.5
export const WEB_OC = 16

export function joistWidth(p: Pick<Params, 'joistStyle'>): number {
  return p.joistStyle === 'builtup' ? BUILTUP_W : RIM_T
}
export const DRAWER_SIDE_GAP = 1
export const DRAWER_BACK_GAP = 1

export interface Section {
  index: number
  rect: Rect
  /** left edges of every joist (rims + dividers) */
  joistX: number[]
  /** thickness of each joist entry in joistX (rims single, dividers maybe doubled) */
  joistT: number[]
  cols: { x: number; w: number }[]
  rows: { y: number; l: number; drawer: boolean }[]
  /** y of the bottom edge of each block line between rows, for the section default */
  blockY: number[]
  /** rows / block lines of each bay (column) between main joists */
  colRows: { y: number; l: number; drawer: boolean }[][]
  colBlocks: number[][]
  /** true when the section's front edge (y = 0) carries drawers */
  drawerFront: boolean
  shareFront?: boolean
  /** true when main joist positions are dictated by drawer widths */
  exact: boolean
  /** plywood filler section: joists only at the filler edges, fixed deck */
  fixed: boolean
  /** joist offsets actually applied after clamping, keyed like Params.moves */
  applied: Record<string, number>
}

export interface Layout {
  sections: Section[]
  cells: Cell[]
  /** plywood filler areas beside the tatami mats; cells under them hold no bins or drawers */
  fillers: Rect[]
  binX: number
  binY: number
  cellMinX: number
  cellMinY: number
  drawerLen: number
  dividerT: number
  /** thickness of every frame member (rims, joists, cross members) */
  joistW: number
  warnings: string[]
}

export function floorRects(p: Pick<Params, 'floor'>): Rect[] {
  return normalizeFloor(p.floor).rects
}

/** Bin footprint expressed along x (across joists) and y (along joists). */
export function binAxes(p: Pick<Params, 'bin' | 'binLongAlongJoists'>): { bx: number; by: number } {
  const long = Math.max(p.bin.w, p.bin.d)
  const short = Math.min(p.bin.w, p.bin.d)
  return p.binLongAlongJoists ? { bx: short, by: long } : { bx: long, by: short }
}

/** n = bin-driven count (as many cells as fit) plus `adjust`, never below 1. */
export function divide(total: number, cellMin: number, dividerT: number, rimT = RIM_T, adjust = 0) {
  const interior = total - 2 * rimT
  const fit = Math.max(1, Math.floor((interior + dividerT) / (cellMin + dividerT) + 1e-9))
  const n = Math.max(1, fit + adjust)
  const cell = (interior - (n - 1) * dividerT) / n
  return { n, fit, cell, fits: cell >= cellMin - 1e-9 }
}

export function buildLayout(p: Params): Layout {
  const warnings: string[] = []
  const T = joistWidth(p)
  const geo = normalizeFloor(p.floor)
  if (geo.error) warnings.push(`Floor shape: ${geo.error}`)
  const { bx, by } = binAxes(p)
  const drawers = p.features.drawers
  const dividerT = p.reinforce.doubleJoists ? T * 2 : T
  const bt = p.drawerBoardT
  const drawerExtraX = drawers ? 2 * (DRAWER_SIDE_GAP + bt) : 0
  const cellMinX = bx + p.clearance + drawerExtraX
  const cellMinY = by + p.clearance
  const drawerLen = bt + (by + p.clearance + 2 * bt) + DRAWER_BACK_GAP
  const binsAcross = (w: number, extra = drawerExtraX) => Math.max(1, Math.floor((w - extra + 1e-6) / (bx + p.clearance)))
  const binsAlong = (l: number) => Math.max(1, Math.floor((l + 1e-6) / cellMinY))

  const sections: Section[] = []
  const cells: Cell[] = []
  const fillers = fillerRects(geo.rects, p)
  const overFiller = (x: number, y: number, w: number, l: number) =>
    fillers.some((f) => Math.min(x + w, f.x + f.w) - Math.max(x, f.x) > 2 && Math.min(y + l, f.y + f.l) - Math.max(y, f.y) > 2)

  // A lift table on the front drawer row takes priority: the drawers share only the front width left on either side of it.
  const liftZones = p.liftTables.map((l) => ({ x: l.x, y: l.y, w: p.tatamiShort, l: p.tatamiShort }))
  const f0 = geo.front
  const onFrontRow = (rect: Rect) =>
    drawers && !!f0 && Math.abs(rect.y - f0.y) < 1e-6 && rect.x >= f0.x1 - 1e-6 && rect.x + rect.w <= f0.x2 + 1e-6
  const liftPieces: { rect: Rect; plain: boolean; exact?: number }[] = geo.rects.flatMap((rect) => {
    const onFront = onFrontRow(rect)
    const zs = liftZones
      .filter((z) => z.x >= rect.x - 0.01 && z.x + z.w <= rect.x + rect.w + 0.01 && z.y < rect.y + drawerLen && z.y + z.l > rect.y)
      .sort((a, b) => a.x - b.x)
    if (!onFront || !zs.length) return [{ rect, plain: false }]
    const out: { rect: Rect; plain: boolean }[] = []
    let cursor = rect.x
    for (const z of zs) {
      if (z.x - cursor > 0.5) out.push({ rect: { ...rect, x: cursor, w: z.x - cursor }, plain: false })
      const x0 = Math.max(z.x, cursor)
      out.push({ rect: { ...rect, x: x0, w: z.x + z.w - x0 }, plain: true })
      cursor = z.x + z.w
    }
    if (rect.x + rect.w - cursor > 0.5) out.push({ rect: { ...rect, x: cursor, w: rect.x + rect.w - cursor }, plain: false })
    return out
  })
  const pieces0: { rect: Rect; plain: boolean; exact?: number; fixed?: boolean }[] = liftPieces

  // A plywood filler strip running the full depth of a section gets its own section, so added joists only
  // subdivide the bin area and never land under the filler.
  const pieces: { rect: Rect; plain: boolean; exact?: number; fixed?: boolean }[] = pieces0.flatMap((pc) => {
    if (pc.exact || pc.plain) return [pc]
    let r = pc.rect
    const inside = fillers.filter((f) => f.w >= 6 && f.l >= 6 && f.x >= r.x - 0.5 && f.x + f.w <= r.x + r.w + 0.5 && f.y >= r.y - 0.5 && f.y + f.l <= r.y + r.l + 0.5)
    const out: { rect: Rect; plain: boolean; fixed?: boolean }[] = []
    const back = inside.filter((f) => f.y + f.l >= r.y + r.l - 0.5)
    if (back.length && back.reduce((s, f) => s + f.w, 0) >= r.w - 0.5) {
      const y0 = Math.min(...back.map((f) => f.y))
      if (y0 - r.y >= cellMinY + 2 * T && r.y + r.l - y0 >= 6) {
        out.push({ rect: { ...r, y: y0, l: r.y + r.l - y0 }, plain: false, fixed: true })
        r = { ...r, l: y0 - r.y }
      }
    }
    const sideSpan = (edgeX: number) => inside.filter((f) => Math.abs(f.x - edgeX) < 0.5 && f.y < r.y + r.l - 0.5)
    const sides = (fs: Rect[]) => (fs.length && fs.reduce((s, f) => s + Math.min(f.y + f.l, r.y + r.l) - Math.max(f.y, r.y), 0) >= r.l - 0.5 ? Math.max(...fs.map((f) => f.w)) : 0)
    const lw = sides(sideSpan(r.x))
    const rw = sides(inside.filter((f) => Math.abs(f.x + f.w - (r.x + r.w)) < 0.5 && f.y < r.y + r.l - 0.5))
    let x0 = r.x
    let x1 = r.x + r.w
    if (lw) { out.push({ rect: { ...r, w: lw }, plain: false, fixed: true }); x0 += lw }
    if (rw) { out.push({ rect: { ...r, x: r.x + r.w - rw, w: rw }, plain: false, fixed: true }); x1 -= rw }
    if (!out.length || x1 - x0 < cellMinX + 2 * T) return [pc]
    return [{ ...pc, rect: { ...r, x: x0, w: x1 - x0 } }, ...out]
  })

  // the drawer row is its own frame; its parallel joists are independent of the ones behind the cross joist that closes it
  const shareFront = new WeakSet<Rect>()
  const split: typeof pieces = pieces.flatMap((pc) => {
    const fr0 = geo.front
    const isFront = drawers && !pc.plain && !pc.exact && !pc.fixed && !!fr0 && Math.abs(pc.rect.y - fr0.y) < 1e-6 && pc.rect.x >= fr0.x1 - 1e-6 && pc.rect.x + pc.rect.w <= fr0.x2 + 1e-6
    const cut = drawerLen + T
    if (!isFront || pc.rect.l - cut < cellMinY + 2 * T) return [pc]
    const rear = { ...pc.rect, y: pc.rect.y + cut, l: pc.rect.l - cut }
    shareFront.add(rear)
    return [{ ...pc, rect: { ...pc.rect, l: cut } }, { ...pc, rect: rear }]
  })
  split.forEach(({ rect, plain, exact, fixed }, si) => {
    const fr = geo.front
    const isFrontSec = drawers && !plain && !exact && !fixed && !!fr && Math.abs(rect.y - fr.y) < 1e-6 && rect.x >= fr.x1 - 1e-6 && rect.x + rect.w <= fr.x2 + 1e-6
    const cmx = isFrontSec ? cellMinX : bx + p.clearance
    const dx = divide(rect.w, cmx, dividerT, T, fixed ? 0 : p.joistAdjust + (p.secAdjust?.[si]?.x ?? 0))
    const cols: Section['cols'] = []
    const ex = 0
    const nCols = exact ?? dx.n
    const cellW = exact ? (rect.w - 2 * T - (exact - 1) * dividerT) / exact : dx.cell
    const joistX: number[] = [rect.x]
    const joistT: number[] = [T + ex]
    // a front bay without a drawer only needs whole bins; the drawer bays take up the rest so joist spacing stays even
    const f1 = geo.front
    const isFront = drawers && !plain && !exact && !!f1 && Math.abs(rect.y - f1.y) < 1e-6 && rect.x >= f1.x1 - 1e-6 && rect.x + rect.w <= f1.x2 + 1e-6
    const offs = Array.from({ length: nCols }, (_, i) => isFront && !!p.drawerOff?.[`${si}:${i}:0`])
    const k = offs.filter(Boolean).length
    const offW = Math.max(1, Math.floor((cellW + 1e-6) / (bx + p.clearance))) * (bx + p.clearance)
    const useOff = k > 0 && k < nCols && offW < cellW
    const onW = useOff ? (rect.w - 2 * T - (nCols - 1) * dividerT - k * offW) / (nCols - k) : cellW
    let xx = rect.x + T + ex
    for (let i = 0; i < nCols; i++) {
      const w = useOff && offs[i] ? offW : onW
      cols.push({ x: xx, w })
      xx += w
      if (i < nCols - 1) {
        joistX.push(xx)
        joistT.push(dividerT)
        xx += dividerT
      }
    }
    joistX.push(rect.x + rect.w - T - ex)
    joistT.push(T + ex)

    const f = geo.front
    const drawerFront0 =
      drawers && !plain && !!f && Math.abs(rect.y - f.y) < 1e-6 && rect.x >= f.x1 - 1e-6 && rect.x + rect.w <= f.x2 + 1e-6
    const evenCells = (start: number, span: number, n: number) => {
      const cell = (span - (n - 1) * T) / n
      return Array.from({ length: n }, (_, j) => ({ y: start + j * (cell + T), l: cell }))
    }
    const tweak = (cells: { y: number; l: number }[], k: number) => {
      let out = cells
      const start = cells[0].y
      const span = cells[cells.length - 1].y + cells[cells.length - 1].l - start
      for (let i = 0; i < Math.abs(k); i++) {
        if (k > 0) {
          let w = 0
          out.forEach((c, j) => { if (c.l > out[w].l) w = j })
          if (out[w].l >= 2 * cellMinY + T - 1e-9) {
            const half = (out[w].l - T) / 2
            out = [...out.slice(0, w), { y: out[w].y, l: half }, { y: out[w].y + half + T, l: half }, ...out.slice(w + 1)]
          } else out = evenCells(start, span, out.length + 1)
        } else if (out.length > 1) {
          let m = 0
          for (let j = 0; j + 1 < out.length; j++) if (out[j].l + out[j + 1].l < out[m].l + out[m + 1].l) m = j
          out = [...out.slice(0, m), { y: out[m].y, l: out[m].l + T + out[m + 1].l }, ...out.slice(m + 2)]
        }
      }
      return out
    }
    // rows between cross joists for one bay (column). The global count (adj) spaces joists evenly; a bay's own extra
    // joists are then added by splitting the widest cell (or removed by merging the narrowest pair), so the others stay put.
    const calcRows = (adj: number, extra = 0, col?: { x: number; w: number }) => {
      // a bay only gets the drawer row (and its back support) when it is not under a filler
      const drawerFront = drawerFront0 && !(col && overFiller(col.x, rect.y, col.w, drawerLen))
      const rows: Section['rows'] = []
      const blockY: number[] = []
      if (drawerFront) {
        let dLen = drawerLen
        const remaining = rect.l - T - dLen - T
        const fitRows = Math.max(0, Math.floor((remaining + T) / (cellMinY + T) + 1e-9))
        const n0 = remaining > 0 ? Math.max(fitRows > 0 ? 1 : 0, fitRows + adj) : 0
        const nRows = n0 === 0 ? (remaining > 0 ? Math.max(0, adj + extra) : 0) : n0
        if (nRows === 0) {
          dLen = rect.l - T
          rows.push({ y: rect.y, l: dLen, drawer: true })
        } else {
          rows.push({ y: rect.y, l: dLen, drawer: true })
          blockY.push(rect.y + dLen)
          const cells = n0 === 0 ? evenCells(rect.y + dLen + T, remaining, nRows) : tweak(evenCells(rect.y + dLen + T, remaining, n0), extra)
          cells.forEach((c, j) => {
            rows.push({ y: c.y, l: c.l, drawer: false })
            if (j < cells.length - 1) blockY.push(c.y + c.l)
          })
        }
      } else {
        const lead = shareFront.has(rect) ? 0 : T
        const dy = divide(rect.l, cellMinY, T, T, adj)
        const cells = tweak(evenCells(rect.y + lead, rect.l - lead - T, dy.n), extra)
        cells.forEach((c, j) => {
          rows.push({ y: c.y, l: c.l, drawer: false })
          if (j < cells.length - 1) blockY.push(c.y + c.l)
        })
      }
      return { rows, blockY }
    }
    const { rows, blockY } = calcRows(fixed ? 0 : p.crossAdjust)
    if (fixed) {
      // under inaccessible filler: exactly one joist along each filler edge (running front to back), cross blocks only where panels meet
      const fs = fillers.filter((f) => Math.min(f.x + f.w, rect.x + rect.w) - Math.max(f.x, rect.x) > 0.5 && Math.min(f.y + f.l, rect.y + rect.l) - Math.max(f.y, rect.y) > 0.5)
      const lines = (lo: number, hi: number, edges: number[], max: number) => {
        const pts = [...new Set(edges.map((e) => Math.round(e * 1000) / 1000))].filter((v) => v > lo + 2 * T && v < hi - 2 * T).sort((a, b) => a - b)
        const out: number[] = []
        const all = [lo, ...pts, hi]
        for (let i = 0; i < all.length - 1; i++) {
          const gap = all[i + 1] - all[i]
          const n = Math.ceil(gap / max - 1e-9)
          for (let k = 1; k < n; k++) out.push(all[i] + (gap * k) / n)
          if (i + 1 < all.length - 1) out.push(all[i + 1])
        }
        return out
      }
      const xl = lines(rect.x, rect.x + rect.w, fs.flatMap((f) => [f.x, f.x + f.w]), p.sheetL)
      const yl = lines(rect.y, rect.y + rect.l, fs.flatMap((f) => [f.y, f.y + f.l]), p.sheetL)
      joistX.length = 0
      joistT.length = 0
      joistX.push(rect.x, ...xl.map((x) => x - T / 2), rect.x + rect.w - T)
      joistT.push(...joistX.map(() => T))
      cols.length = 0
      for (let k = 0; k < joistX.length - 1; k++) cols.push({ x: joistX[k] + T, w: joistX[k + 1] - joistX[k] - T })
      blockY.length = 0
      blockY.push(...yl.map((y) => y - T / 2))
      rows.length = 0
      let start = rect.y + T
      for (const by of blockY) {
        rows.push({ y: start, l: by - start, drawer: false })
        start = by + T
      }
      rows.push({ y: start, l: rect.y + rect.l - T - start, drawer: false })
    }
    const adjustFixed = (extra: number) => {
      if (extra <= 0) return { rows, blockY }
      const out = tweak(rows.map((r) => ({ y: r.y, l: r.l })), extra + 1)
      return { rows: out.map((c) => ({ y: c.y, l: c.l, drawer: false })), blockY: out.slice(0, -1).map((c) => c.y + c.l) }
    }
    const mv = p.moves ?? {}
    const applied: Record<string, number> = {}
    // manual joist moves: shift a joist, clamp so neighbours keep a full cell, then rebuild the cells between joists
    if (!exact && !fixed && joistX.some((_, k) => k > 0 && k < joistX.length - 1 && mv[`${si}:x:${k}`])) {
      const last = joistX.length - 1
      const end = rect.x + rect.w - T
      const base = [...joistX]
      for (let k = 1; k < last; k++) {
        const lo = joistX[k - 1] + joistT[k - 1] + cmx
        const hi = base[k + 1] - joistT[k] - cmx
        joistX[k] = Math.min(Math.max(base[k] + (mv[`${si}:x:${k}`] ?? 0), lo), Math.max(lo, hi))
        applied[`${si}:x:${k}`] = joistX[k] - base[k]
      }
      joistX[last] = end
      cols.length = 0
      for (let k = 0; k < last; k++) {
        const x = joistX[k] + joistT[k]
        cols.push({ x, w: joistX[k + 1] - x })
      }
    }

    // every bay between two main joists keeps its own cross joists, so adding or removing one never touches the neighbours
    const colData = cols.map((col, ci) => (fixed ? adjustFixed(p.colAdjust?.[`${si}:${ci}`] ?? 0) : calcRows(p.crossAdjust, p.colAdjust?.[`${si}:${ci}`] ?? 0, col)))
    sections.push({ index: si, rect, joistX, joistT, cols, rows, blockY, colRows: colData.map((c) => c.rows), colBlocks: colData.map((c) => c.blockY), drawerFront: drawerFront0, shareFront: shareFront.has(rect), exact: !!exact, fixed: !!fixed, applied })
    cols.forEach((col, ci) => {
      colData[ci].rows.forEach((row, ri) => {
        const key = `${si}:${ci}:${ri}`
        const type: Cell['type'] = overFiller(col.x, row.y, col.w, row.l) ? 'service' : row.drawer && !p.drawerOff?.[key] ? 'drawer' : 'bin'
        const isSvc = type === 'service'
        const needL = row.drawer ? drawerLen - 0.01 : cellMinY
        const fitsBin = isSvc || (col.w >= (isFrontSec ? cellMinX : bx + p.clearance) - 1e-6 && row.l >= needL - 1e-6)
        cells.push({
          index: cells.length,
          key: `${si}:${ci}:${ri}`,
          section: si,
          x: col.x,
          y: row.y,
          w: col.w,
          l: row.l,
          type,
          fitsBin,
          binsX: isSvc ? 0 : binsAcross(col.w, isFrontSec ? drawerExtraX : 0),
          binsY: isSvc ? 0 : type === 'drawer' ? 1 : binsAlong(row.l),
          drawerBay: row.drawer && !isSvc,
        })
        if (!fitsBin) {
          warnings.push(
            `Section ${si + 1}: a ${type} cell is ${col.w.toFixed(2)}" x ${row.l.toFixed(2)}" - too small for the bin. Remove a joist/cross joist, make the floor larger or pick a smaller bin.`,
          )
        }
      })
    })
  })

  return { sections, cells, fillers, binX: bx, binY: by, cellMinX, cellMinY, drawerLen, dividerT, joistW: T, warnings: [...new Set(warnings)] }
}

