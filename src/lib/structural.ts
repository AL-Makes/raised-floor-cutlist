import type { Build } from './build'
import type { Params } from './types'

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
export function joistCapacityPsf(thickness: number, depth: number, span: number, spacing: number): number {
  const S = (thickness * depth * depth) / 6
  const I = (thickness * depth ** 3) / 12
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

export function analyze(b: Build): Structural {
  const p = b.params
  const t = p.plyThickness
  const cells: CellAnalysis[] = b.layout.cells.map((c) => {
    const hatch = p.features.hatches && c.type === 'bin'
    const span = c.w + (hatch ? 0.5 : 0)
    const cap = plyCapacity(t, span)
    const ratio = Math.min(cap.psf / p.designLoadPsf, cap.pointLb / p.pointLoadLb)
    return { cell: c.index, span, psf: cap.psf, pointLb: cap.pointLb, ratio, status: statusOf(ratio) }
  })
  const minPsf = cells.length ? Math.min(...cells.map((c) => c.psf)) : 0
  const minPointLb = cells.length ? Math.min(...cells.map((c) => c.pointLb)) : 0
  const issues: Issue[] = []
  const suggestions: Suggestion[] = []

  const bad = cells.filter((c) => c.status !== 'ok')
  if (bad.length) {
    const fail = bad.filter((c) => c.status === 'fail')
    issues.push({
      severity: fail.length ? 'fail' : 'warn',
      text: `${bad.length} deck/hatch span(s) are weak for ${p.designLoadPsf} psf / ${p.pointLoadLb} lb point load (worst span ${Math.max(...bad.map((c) => c.span)).toFixed(1)}").`,
      cells: bad.map((c) => c.cell),
    })
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
  let joistPsf: number | undefined
  if (p.shimSpacing > 0 && b.option) {
    joistPsf = joistCapacityPsf(b.layout.dividerT, b.option.depth, p.shimSpacing, spacingOC)
    if (joistPsf < p.designLoadPsf) {
      issues.push({
        severity: joistPsf < p.designLoadPsf * 0.75 ? 'fail' : 'warn',
        text: `Joists spanning ${p.shimSpacing}" between shims carry only about ${Math.round(joistPsf)} psf.`,
      })
      suggestions.push({
        id: 'tighter-shims',
        text: 'Keep the joists bearing continuously on the slab, or shim at a closer spacing.',
        apply: (q) => ({ ...q, shimSpacing: Math.max(6, Math.floor(q.shimSpacing / 2)) }),
      })
      if (!p.reinforce.doubleJoists) {
        suggestions.push({
          id: 'double-joists',
          text: 'Double the interior joists (pocket-screw and glue side by side).',
          apply: (q) => ({ ...q, reinforce: { ...q.reinforce, doubleJoists: true } }),
        })
      }
    }
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
