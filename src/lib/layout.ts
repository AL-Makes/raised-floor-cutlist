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

/** Ready-made rolling box: long side runs along the joists so it pulls out toward the front. */
export function rollingAxes(p: Pick<Params, 'rollingBox'>): { rx: number; ry: number } {
  return { rx: Math.min(p.rollingBox.w, p.rollingBox.d), ry: Math.max(p.rollingBox.w, p.rollingBox.d) }
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
  const pieces: { rect: Rect; plain: boolean }[] = geo.rects.flatMap((rect) => {
    const onFront = drawers && !!f0 && Math.abs(rect.y - f0.y) < 1e-6 && rect.x >= f0.x1 - 1e-6 && rect.x + rect.w <= f0.x2 + 1e-6
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

  pieces.forEach(({ rect, plain }, si) => {
    const dx = divide(rect.w, cellMinX, dividerT, T, p.joistAdjust)
    const cols: Section['cols'] = []
    const joistX: number[] = [rect.x]
    const joistT: number[] = [T]
    for (let i = 0; i < dx.n; i++) {
      const x = rect.x + T + i * (dx.cell + dividerT)
      cols.push({ x, w: dx.cell })
      if (i < dx.n - 1) {
        joistX.push(x + dx.cell)
        joistT.push(dividerT)
      }
    }
    joistX.push(rect.x + rect.w - T)
    joistT.push(T)

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

    sections.push({ index: si, rect, joistX, joistT, cols, rows, blockY, drawerFront })
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

