import type { Part } from './types'

export interface Board {
  cuts: number[]
  used: number
}

export interface LumberPlan {
  material: string
  stockLength: number
  boards: Board[]
  totalCutLength: number
  wastePct: number
  unfit: number[]
}

function pack(pieces: number[], stock: number, kerf: number): { boards: Board[]; unfit: number[] } {
  const sorted = [...pieces].sort((a, b) => b - a)
  const boards: Board[] = []
  const unfit: number[] = []
  for (const len of sorted) {
    if (len > stock + 1e-9) {
      unfit.push(len)
      continue
    }
    const b = boards.find((x) => x.used + (x.cuts.length ? kerf : 0) + len <= stock + 1e-9)
    if (b) {
      b.used += (b.cuts.length ? kerf : 0) + len
      b.cuts.push(len)
    } else boards.push({ cuts: [len], used: len })
  }
  return { boards, unfit }
}

/** Pick the stock length that minimises purchased board-inches, then pack with first-fit-decreasing. */
export function planLumber(material: string, parts: Part[], lengths: number[], kerf: number): LumberPlan {
  const pieces: number[] = []
  for (const p of parts) for (let i = 0; i < p.qty; i++) pieces.push(p.length)
  const totalCutLength = pieces.reduce((s, v) => s + v, 0)
  let best: LumberPlan | undefined
  for (const stock of [...lengths].sort((a, b) => a - b)) {
    const { boards, unfit } = pack(pieces, stock, kerf)
    const bought = boards.length * stock
    const plan: LumberPlan = {
      material,
      stockLength: stock,
      boards,
      totalCutLength,
      wastePct: bought ? (1 - (totalCutLength - unfit.reduce((s, v) => s + v, 0)) / bought) * 100 : 0,
      unfit,
    }
    if (!best) best = plan
    else if (unfit.length < best.unfit.length) best = plan
    else if (unfit.length === best.unfit.length && boards.length * stock < best.boards.length * best.stockLength - 1e-9)
      best = plan
  }
  return best ?? { material, stockLength: 0, boards: [], totalCutLength, wastePct: 0, unfit: pieces }
}

export interface PlacedPiece {
  x: number
  y: number
  w: number
  h: number
  name: string
}

export interface SheetLayout {
  pieces: PlacedPiece[]
}

export interface SheetPlan {
  material: string
  sheets: SheetLayout[]
  wastePct: number
  unfit: string[]
}

/** Shelf packing (rotation allowed). Sheet is sheetL (x) by sheetW (y). */
export function planSheets(material: string, parts: Part[], sheetL: number, sheetW: number, kerf: number): SheetPlan {
  interface Piece {
    a: number
    b: number
    name: string
  }
  const pieces: Piece[] = []
  const unfit: string[] = []
  for (const p of parts) {
    for (let i = 0; i < p.qty; i++) {
      const a = Math.max(p.length, p.width)
      const b = Math.min(p.length, p.width)
      if ((a > sheetL + 1e-9 || b > sheetW + 1e-9) && (a > sheetW + 1e-9 || b > sheetL + 1e-9)) unfit.push(p.name)
      else pieces.push({ a, b, name: p.name })
    }
  }
  pieces.sort((p, q) => q.b - p.b || q.a - p.a)

  interface Shelf {
    y: number
    h: number
    x: number
  }
  interface Sheet {
    shelves: Shelf[]
    y: number
    pieces: PlacedPiece[]
  }
  const sheets: Sheet[] = []
  const place = (s: Sheet, pc: Piece): boolean => {
    const orients: [number, number][] = [[pc.a, pc.b]]
    if (pc.a <= sheetW + 1e-9 && pc.b <= sheetL + 1e-9) orients.push([pc.b, pc.a])
    for (const [w, h] of orients) {
      if (w > sheetL + 1e-9 || h > sheetW + 1e-9) continue
      for (const sh of s.shelves) {
        if (h <= sh.h + 1e-9 && sh.x + w <= sheetL + 1e-9) {
          s.pieces.push({ x: sh.x, y: sh.y, w, h, name: pc.name })
          sh.x += w + kerf
          return true
        }
      }
      if (s.y + h <= sheetW + 1e-9) {
        const sh = { y: s.y, h, x: w + kerf }
        s.shelves.push(sh)
        s.pieces.push({ x: 0, y: s.y, w, h, name: pc.name })
        s.y += h + kerf
        return true
      }
    }
    return false
  }
  for (const pc of pieces) {
    if (!sheets.some((s) => place(s, pc))) {
      const s: Sheet = { shelves: [], y: 0, pieces: [] }
      sheets.push(s)
      place(s, pc)
    }
  }
  const used = pieces.reduce((s, p) => s + p.a * p.b, 0)
  const bought = sheets.length * sheetL * sheetW
  return {
    material,
    sheets: sheets.map((s) => ({ pieces: s.pieces })),
    wastePct: bought ? (1 - used / bought) * 100 : 0,
    unfit,
  }
}
