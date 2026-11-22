import type { Build } from './build'
import type { Mat } from './tatami'

const LUMBER_LB_PER_IN3 = 25 / 1728 // kiln-dried SPF
const PLY_LB_PER_IN3 = 34 / 1728
const TATAMI_LB_PER_IN3 = 20 / 1728 // woven rush over a compressed fibre core
/** purchased motorized column with motor, control box and top plate */
export const LIFT_COLUMN_LB = 60

export interface WeightRow {
  label: string
  lb: number
  note?: string
}

/**
 * Dead weight of the structure itself: framing, plywood, drawer boxes, trim, tatami and lift-table assemblies.
 * Bins and whatever is stored in them, and anything standing on top (TV, TV stand, people), are not counted.
 */
export function estimateWeight(build: Build, mats: Mat[]): { rows: WeightRow[]; total: number } {
  const p = build.params
  const lumber = (pred: (n: string) => boolean) =>
    build.parts.filter((x) => x.kind === 'lumber' && pred(x.name)).reduce((s, x) => s + x.qty * x.length * x.width * x.thickness * LUMBER_LB_PER_IN3, 0)
  const sheet = (pred: (g: string, n: string) => boolean) =>
    build.parts.filter((x) => x.kind === 'sheet' && pred(x.group, x.name)).reduce((s, x) => s + x.qty * x.length * x.width * x.thickness * PLY_LB_PER_IN3, 0)
  const isLiftPly = (n: string) => n.startsWith('Lift table top') || n.startsWith('False floor under lift')
  const isLiftPost = (n: string) => n.startsWith('Lift false-floor post')

  const tatamiArea = mats.filter((m) => m.kind !== 'cut').reduce((s, m) => s + m.w * m.l, 0)
  const fillerArea = mats.filter((m) => m.kind === 'cut').reduce((s, m) => s + m.w * m.l, 0)
  const lifts = p.liftTables.length

  const rows: WeightRow[] = [
    { label: 'Lumber framing (joists, rims, blocks, supports)', lb: lumber((n) => !isLiftPost(n)) },
    { label: 'Plywood deck panels', lb: sheet((g, n) => g === 'Deck' && !isLiftPly(n)) },
    { label: 'Drawer boxes (empty)', lb: sheet((g) => g === 'Drawers') },
    { label: 'Edge trim / side panels / fascia', lb: sheet((g) => g === 'Edge trim') },
    { label: 'Tatami mats', lb: tatamiArea * p.tatamiThickness * TATAMI_LB_PER_IN3 },
    { label: 'Plywood filler pieces (laminated to mat height)', lb: fillerArea * p.tatamiThickness * PLY_LB_PER_IN3 },
  ]
  if (lifts)
    rows.push({
      label: `Motorized table assembly x ${lifts}`,
      lb: lifts * LIFT_COLUMN_LB + sheet((_g, n) => isLiftPly(n)) + lumber((n) => isLiftPost(n)),
      note: `column, motor and controller assumed ${LIFT_COLUMN_LB} lb each, plus its table top, false floor and posts. Its tatami mat is counted with the mats.`,
    })
  const out = rows.filter((r) => r.lb > 0.05)
  return { rows: out, total: out.reduce((s, r) => s + r.lb, 0) }
}
