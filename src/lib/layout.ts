import { normalizeFloor } from './geometry'
import type { Cell, Params, Rect } from './types'

export const RIM_T = 1.5
/** Built-up joist: two 2x4 chords laid flat (top + bottom) with vertical 2x4 webs between them, so it is 3-1/2" wide. */
export const BUILTUP_W = 3.5
export const WEB_OC = 16

export function joistWidth(p: Pick<Params, 'joistStyle'>): number {
  return p.joistStyle === 'builtup' ? BUILTUP_W : RIM_T
}
export const DRAWER_WALL = 0.5
export const DRAWER_SLIDE = 0.5
export const DRAWER_FACE_T = 0.75

export interface Section {
  index: number
  rect: Rect
  /** left edges of every joist (rims + dividers) */
  joistX: number[]
  /** thickness of each joist entry in joistX (rims single, dividers maybe doubled) */
  joistT: number[]
  cols: { x: number; w: number }[]
  rows: { y: number; l: number; drawer: boolean }[]
  /** y of the bottom edge of each block line between rows */
  blockY: number[]
  /** true when the section's front edge (y = 0) carries drawers */
  drawerFront: boolean
  /** true when main joist positions are dictated by drawer widths */
  exact: boolean
  /** joist offsets actually applied after clamping, keyed like Params.moves */
  applied: Record<string, number>
}

export interface Layout {
  sections: Section[]
  cells: Cell[]
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

/** Ready-made rolling box: long side runs across the front, short side pulls out toward the back. */
export function rollingAxes(p: Pick<Params, 'rollingBox'>): { rx: number; ry: number } {
  return { rx: Math.max(p.rollingBox.w, p.rollingBox.d), ry: Math.min(p.rollingBox.w, p.rollingBox.d) }
}

export function buildLayout(p: Params): Layout {
  const warnings: string[] = []
  const T = joistWidth(p)
  const geo = normalizeFloor(p.floor)
  if (geo.error) warnings.push(`Floor shape: ${geo.error}`)
  const { bx, by } = binAxes(p)
  const drawers = p.features.drawers
  const dividerT = p.reinforce.doubleJoists ? T * 2 : T
  const ready = drawers && p.drawerKind === 'ikea'
  const { rx, ry } = rollingAxes(p)
  const drawerExtraX = drawers && !ready ? 2 * (DRAWER_WALL + DRAWER_SLIDE) : 0
  const cellMinX = ready ? Math.max(bx, rx) + p.clearance : bx + p.clearance + drawerExtraX
  const cellMinY = by + p.clearance
  const drawerLen = ready ? DRAWER_FACE_T + ry + p.clearance : DRAWER_FACE_T + (by + p.clearance + 2 * DRAWER_WALL) + 0.5
  const binsAcross = (w: number) => Math.max(1, Math.floor((w - drawerExtraX + 1e-6) / (bx + p.clearance)))
  const binsAlong = (l: number) => Math.max(1, Math.floor((l + 1e-6) / cellMinY))

  const sections: Section[] = []
  const cells: Cell[] = []

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
  // Ready-made drawers sit snug between joists (clearance split evenly each side), so the cells are exactly one
  // box wide. Leftover width becomes a plain bin section if it is big enough, otherwise it widens the end joists.
  const pieces: { rect: Rect; plain: boolean; exact?: number }[] = liftPieces.flatMap((pc) => {
    if (!ready || pc.plain || !onFrontRow(pc.rect)) return [pc]
    const r = pc.rect
    const nFit = Math.max(1, Math.floor((r.w - 2 * T + dividerT) / (cellMinX + dividerT) + 1e-9))
    const n = Math.max(1, Math.min(nFit, nFit + p.joistAdjust))
    const W = 2 * T + n * cellMinX + (n - 1) * dividerT
    const extra = r.w - W
    if (extra < -1e-6) return [pc]
    if (extra >= bx + p.clearance + 2 * T) {
      return [
        { rect: { ...r, w: W }, plain: false, exact: n },
        { rect: { ...r, x: r.x + W, w: extra }, plain: true },
      ]
    }
    return [{ ...pc, exact: n }]
  })

  pieces.forEach(({ rect, plain, exact }, si) => {
    const dx = divide(rect.w, cellMinX, dividerT, T, p.joistAdjust)
    const cols: Section['cols'] = []
    const ex = 0
    const nCols = exact ?? dx.n
    const cellW = exact ? (rect.w - 2 * T - (exact - 1) * dividerT) / exact : dx.cell
    const joistX: number[] = [rect.x]
    const joistT: number[] = [T + ex]
    for (let i = 0; i < nCols; i++) {
      const x = rect.x + T + ex + i * (cellW + dividerT)
      cols.push({ x, w: cellW })
      if (i < nCols - 1) {
        joistX.push(x + cellW)
        joistT.push(dividerT)
      }
    }
    joistX.push(rect.x + rect.w - T - ex)
    joistT.push(T + ex)

    const f = geo.front
    const drawerFront =
      drawers && !plain && !!f && Math.abs(rect.y - f.y) < 1e-6 && rect.x >= f.x1 - 1e-6 && rect.x + rect.w <= f.x2 + 1e-6
    const rows: Section['rows'] = []
    const blockY: number[] = []
    if (drawerFront) {
      let dLen = drawerLen
      const remaining = rect.l - T - dLen - T
      const fitRows = Math.max(0, Math.floor((remaining + T) / (cellMinY + T) + 1e-9))
      const nRows = remaining > 0 ? Math.max(fitRows > 0 ? 1 : 0, fitRows + p.crossAdjust) : 0
      if (nRows === 0) {
        dLen = rect.l - T
        rows.push({ y: rect.y, l: dLen, drawer: true })
      } else {
        rows.push({ y: rect.y, l: dLen, drawer: true })
        blockY.push(rect.y + dLen)
        const cellY = (remaining - (nRows - 1) * T) / nRows
        for (let j = 0; j < nRows; j++) {
          const y = rect.y + dLen + T + j * (cellY + T)
          rows.push({ y, l: cellY, drawer: false })
          if (j < nRows - 1) blockY.push(y + cellY)
        }
      }
    } else {
      const dy = divide(rect.l, cellMinY, T, T, p.crossAdjust)
      for (let j = 0; j < dy.n; j++) {
        const y = rect.y + T + j * (dy.cell + T)
        rows.push({ y, l: dy.cell, drawer: false })
        if (j < dy.n - 1) blockY.push(y + dy.cell)
      }
    }

    const mv = p.moves ?? {}
    const applied: Record<string, number> = {}
    // manual joist moves: shift a joist, clamp so neighbours keep a full cell, then rebuild the cells between joists
    const lowK = drawerFront ? 1 : 0
    if (blockY.some((_, k) => k >= lowK && mv[`${si}:y:${k}`])) {
      const end = rect.y + rect.l - T
      const base = [...blockY]
      for (let k = lowK; k < blockY.length; k++) {
        const prevEdge = k === 0 ? rect.y + T : blockY[k - 1] + T
        const lo = prevEdge + cellMinY
        const hi = (k + 1 < base.length ? base[k + 1] : end) - T - cellMinY
        blockY[k] = Math.min(Math.max(base[k] + (mv[`${si}:y:${k}`] ?? 0), lo), Math.max(lo, hi))
        applied[`${si}:y:${k}`] = blockY[k] - base[k]
      }
      rows.length = 0
      let start = rect.y + T
      if (drawerFront) {
        rows.push({ y: rect.y, l: drawerLen, drawer: true })
        start = blockY[0] + T
      }
      for (let k = drawerFront ? 1 : 0; k <= blockY.length; k++) {
        const stop = k < blockY.length ? blockY[k] : end
        rows.push({ y: start, l: stop - start, drawer: false })
        start = stop + T
      }
    }
    if (!exact && joistX.some((_, k) => k > 0 && k < joistX.length - 1 && mv[`${si}:x:${k}`])) {
      const last = joistX.length - 1
      const end = rect.x + rect.w - T
      const base = [...joistX]
      for (let k = 1; k < last; k++) {
        const lo = joistX[k - 1] + joistT[k - 1] + cellMinX
        const hi = base[k + 1] - joistT[k] - cellMinX
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

    sections.push({ index: si, rect, joistX, joistT, cols, rows, blockY, drawerFront, exact: !!exact, applied })
    for (const row of rows) {
      for (const col of cols) {
        const type = row.drawer ? 'drawer' : 'bin'
        const needL = row.drawer ? drawerLen - 0.01 : cellMinY
        const fitsBin = col.w >= cellMinX - 1e-6 && row.l >= needL - 1e-6
        cells.push({
          index: cells.length,
          section: si,
          x: col.x,
          y: row.y,
          w: col.w,
          l: row.l,
          type,
          fitsBin,
          binsX: binsAcross(col.w),
          binsY: row.drawer ? 1 : binsAlong(row.l),
        })
        if (!fitsBin) {
          warnings.push(
            `Section ${si + 1}: a ${type} cell is ${col.w.toFixed(2)}" x ${row.l.toFixed(2)}" - too small for the bin. Remove a joist/cross joist, make the floor larger or pick a smaller bin.`,
          )
        }
      }
    }
  })

  return { sections, cells, binX: bx, binY: by, cellMinX, cellMinY, drawerLen, dividerT, joistW: T, warnings: [...new Set(warnings)] }
}

