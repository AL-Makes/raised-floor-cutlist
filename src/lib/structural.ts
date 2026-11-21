import { buildFloor, type Build } from './build'
import type { Params } from './types'

function buildFloorLazy(p: Params): Build | null {
  try {
    return buildFloor(p)
  } catch {
    return null
  }
}

const FB_PLY = 1000
const E_PLY = 1_000_000
const FB_LUMBER = 1000
const E_LUMBER = 1_400_000

export interface PanelCapacity {
  /** allowable uniform load, psf */
  psf: number
  /** allowable concentrated load at midspan on a 12" wide strip, lb */
  pointLb: number
}

/** Simple-span plywood strip (12" wide), bending and L/360 deflection. Point load assumes 24" effective width (tatami spreads it). */
export function plyCapacity(t: number, span: number): PanelCapacity {
  const S = 2 * t * t
  const I = t ** 3
  const M = FB_PLY * S
  const wBend = (8 * M) / (span * span)
  const wDefl = (384 * E_PLY * I) / (5 * 360 * span ** 3)
  return { psf: Math.min(wBend, wDefl) * 12, pointLb: (8 * M) / span }
}

/** Joist spanning between shim supports; returns allowable psf over its tributary width. */
export function joistCapacityPsf(thickness: number, depth: number, span: number, spacing: number, builtup = false): number {
  let S = (thickness * depth * depth) / 6
  let I = (thickness * depth ** 3) / 12
  if (builtup) {
    // two flat 2x4 chords (3.5 x 1.5) top and bottom; webs only hold them apart. 	hickness is 3.5 per joist (x2 if doubled).
    const h = 1.5
    const per = 2 * ((3.5 * h ** 3) / 12 + 3.5 * h * ((depth - h) / 2) ** 2)
    I = per * (thickness / 3.5)
    S = I / (depth / 2)
  }
  const wBend = (8 * FB_LUMBER * S) / (span * span)
  const wDefl = (384 * E_LUMBER * I) / (5 * 360 * span ** 3)
  const lbPerFt = Math.min(wBend, wDefl) * 12
  return lbPerFt / (spacing / 12)
}

export type Status = 'ok' | 'warn' | 'fail'

export interface CellAnalysis {
  cell: number
  span: number
  psf: number
  pointLb: number
  status: Status
  ratio: number
}

export interface Issue {
  severity: Status
  text: string
  cells?: number[]
}

export interface Suggestion {
  id: string
  text: string
  apply?: (p: Params) => Params
}

export interface Structural {
  cells: CellAnalysis[]
  /** weakest allowable uniform load across all cells, psf */
  minPsf: number
  minPointLb: number
  joistPsf?: number
  issues: Issue[]
  suggestions: Suggestion[]
}

const PLY_STEPS = [0.5, 0.625, 0.75, 1, 1.125]

function statusOf(ratio: number): Status {
  return ratio >= 1.5 ? 'ok' : ratio >= 1 ? 'warn' : 'fail'
}

/** Joist span between bearing points (supportCount points per joist; 0 = continuous bearing). */
function joistSpan(b: Build): number | undefined {
  const p = b.params
  if (p.supportCount < 2) return undefined
  const longest = Math.max(...b.layout.sections.map((s) => s.rect.l), 0)
  return longest / (p.supportCount - 1)
}

function joistRatio(b: Build): number {
  const span = joistSpan(b)
  if (span === undefined || !b.option) return Infinity
  const p = b.params
  const spacing = b.layout.cellMinX + b.layout.dividerT
  return joistCapacityPsf(b.layout.dividerT, b.option.depth, span, spacing, p.joistStyle === 'builtup') / p.designLoadPsf
}

function cellAnalysis(b: Build): CellAnalysis[] {
  const p = b.params
  return b.layout.cells.map((c) => {
    const hatch = p.features.hatches && c.type === 'bin'
    const span = Math.min(c.w, c.l) + (hatch ? 0.5 : 0)
    const cap = plyCapacity(p.plyThickness, span)
    const ratio = Math.min(cap.psf / p.designLoadPsf, cap.pointLb / p.pointLoadLb)
    return { cell: c.index, span, psf: cap.psf, pointLb: cap.pointLb, ratio, status: statusOf(ratio) }
  })
}

function worstRatio(b: Build): number {
  const cs = cellAnalysis(b)
  return Math.min(cs.length ? Math.min(...cs.map((c) => c.ratio)) : Infinity, joistRatio(b))
}

export function analyze(b: Build): Structural {
  const p = b.params
  const t = p.plyThickness
  const cells = cellAnalysis(b)
  const minPsf = cells.length ? Math.min(...cells.map((c) => c.psf)) : 0
  const minPointLb = cells.length ? Math.min(...cells.map((c) => c.pointLb)) : 0
  const issues: Issue[] = []
  const suggestions: Suggestion[] = []

  const bad = cells.filter((c) => c.status !== 'ok')
  const baseWorst = worstRatio(b)
  const tryAdd = (id: string, text: string, apply: (q: Params) => Params) => {
    const trial = buildFloorLazy(apply(p))
    if (!trial) return
    const ok = trial.layout.warnings.length <= b.layout.warnings.length
    if (ok && worstRatio(trial) > baseWorst * 1.02) suggestions.push({ id, text, apply })
  }
  if (bad.length) {
    const fail = bad.filter((c) => c.status === 'fail')
    issues.push({
      severity: fail.length ? 'fail' : 'warn',
      text: `${bad.length} deck/hatch span(s) are weak for ${p.designLoadPsf} psf / ${p.pointLoadLb} lb point load (worst span ${Math.max(...bad.map((c) => c.span)).toFixed(1)}"). More cross joists or main joists are recommended.`,
      cells: bad.map((c) => c.cell),
    })
    tryAdd('more-cross', 'Add one more cross joist row (shorter deck spans along the joists).', (q) => ({ ...q, crossAdjust: q.crossAdjust + 1 }))
    tryAdd('more-joists', 'Add one more main joist (narrower cells; each bin then has less spare room).', (q) => ({ ...q, joistAdjust: q.joistAdjust + 1 }))
    const worstSpan = Math.max(...cells.map((c) => c.span))
    const okThickness = PLY_STEPS.find((s) => s > t && plyCapacity(s, worstSpan).psf / p.designLoadPsf >= 1.5 && plyCapacity(s, worstSpan).pointLb / p.pointLoadLb >= 1.5)
    const next = okThickness ?? PLY_STEPS.find((s) => s > t)
    if (next) {
      suggestions.push({
        id: 'thicker-ply',
        text: `Use ${next}" plywood for the deck and hatches${okThickness ? '' : ' (helps, but narrower spans are also needed)'}. The height solver re-computes the frame.`,
        apply: (q) => ({ ...q, plyThickness: next, heightOption: 0 }),
      })
    }
    if (b.layout.binY < b.layout.binX - 0.01) {
      suggestions.push({
        id: 'rotate-bin',
        text: `Rotate the bins so the short side runs across the joists (spans drop from ${b.layout.binX.toFixed(1)}" to ${b.layout.binY.toFixed(1)}").`,
        apply: (q) => ({ ...q, binLongAlongJoists: !q.binLongAlongJoists }),
      })
    }
    if (p.features.hatches) {
      suggestions.push({
        id: 'hatch-note',
        text: 'Wide hatches flex most: glue a second 1/4" ply skin under each hatch panel, or split wide hatches into two smaller ones.',
      })
    }
  }

  const spacingOC = b.layout.cellMinX + b.layout.dividerT
  const span = joistSpan(b)
  let joistPsf: number | undefined
  if (span !== undefined && b.option) {
    joistPsf = joistCapacityPsf(b.layout.dividerT, b.option.depth, span, spacingOC, p.joistStyle === 'builtup')
    if (joistPsf < p.designLoadPsf) {
      issues.push({
        severity: joistPsf < p.designLoadPsf * 0.75 ? 'fail' : 'warn',
        text: `Joists spanning ${span.toFixed(1)}" between supports carry only about ${Math.round(joistPsf)} psf. More supports are recommended.`,
      })
      tryAdd('more-supports', `Add a support point per joist (${p.supportCount + 1} total).`, (q) => ({ ...q, supportCount: q.supportCount + 1 }))
      if (!p.reinforce.doubleJoists) {
        suggestions.push({
          id: 'double-joists',
          text: 'Double the interior joists (pocket-screw and glue side by side).',
          apply: (q) => ({ ...q, reinforce: { ...q.reinforce, doubleJoists: true } }),
        })
      }
    }
  }

  const maxCross = Math.max(0, ...b.layout.sections.map((s) => (s.blockY.length ? s.rect.l / (s.blockY.length + 1) : s.rect.l)))
  if (b.option && b.option.depth / 1.5 > 2 && maxCross > 96) {
    issues.push({ severity: 'warn', text: `Cross joists are ${Math.round(maxCross)}" apart; deep joists over 96" unbraced can roll. Add a cross joist row.` })
    tryAdd('bridge', 'Add one more cross joist row for bridging.', (q) => ({ ...q, crossAdjust: q.crossAdjust + 1 }))
  }

  if (b.unsupportedSeams.length) {
    issues.push({ severity: 'warn', text: `${b.unsupportedSeams.length} plywood seam(s) are not over a joist or block (weak edge).` })
    suggestions.push({ id: 'seams', text: 'Adjust the floor size or bin clearance slightly so seams land on supports, or glue and screw a cleat strip behind the seam.' })
  }

  if (!b.height.fits) issues.push({ severity: 'fail', text: b.height.message ?? 'Bins do not fit at this height.' })
  if (p.maxSpacing > 0 && spacingOC > p.maxSpacing + 1e-9) {
    issues.push({ severity: 'warn', text: `Joist spacing is ${spacingOC.toFixed(1)}" on centre, over your ${p.maxSpacing}" limit (set by the bin size).` })
  }
  const cantilever = p.features.drawers
  if (cantilever) {
    issues.push({ severity: 'warn', text: 'The deck edge over the drawer openings is carried only by the 2x4 header - keep heavy furniture off the front 4".' })
  }

  return { cells, minPsf, minPointLb, joistPsf, issues, suggestions }
}
