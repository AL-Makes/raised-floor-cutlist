export interface LumberSize {
  key: string
  /** actual thickness / depth, inches */
  t: number
  d: number
}

export const JOIST_SIZES: LumberSize[] = [
  { key: '2x4', t: 1.5, d: 3.5 },
  { key: '2x6', t: 1.5, d: 5.5 },
  { key: '2x8', t: 1.5, d: 7.25 },
  { key: '2x10', t: 1.5, d: 9.25 },
  { key: '2x12', t: 1.5, d: 11.25 },
]

export interface Layer {
  name: string
  material: string
  t: number
}

const LAYER_TYPES: Layer[] = [
  { name: '2x4 laid flat', material: '2x4', t: 1.5 },
  { name: '1x4 laid flat', material: '1x4', t: 0.75 },
  { name: '1/2" plywood strip', material: 'ply-strip-0.5', t: 0.5 },
  { name: '1/4" plywood strip', material: 'ply-strip-0.25', t: 0.25 },
]

export interface HeightOption {
  id: string
  label: string
  joist: LumberSize
  /** set when the joist board is ripped down to this depth */
  ripTo?: number
  /** effective on-edge depth of the joist board */
  depth: number
  /** flat strips laminated under each joist (pocket screws + glue) */
  layers: Layer[]
  achieved: number
  error: number
  exact: boolean
}

export interface HeightSolution {
  /** support height = final - deck - tatami */
  target: number
  /** minimum support height for the chosen bin / drawer setup */
  required: number
  fits: boolean
  /** minimum final height that fits the bins */
  minFinalHeight: number
  options: HeightOption[]
  message?: string
}

export const TOLERANCE = 1 / 16

export const DRAWER_EXTRA = 3.25
export const HATCH_EXTRA = 0.5

export function requiredSupport(binH: number, drawers: boolean): number {
  return binH + (drawers ? DRAWER_EXTRA : HATCH_EXTRA)
}

function layerCombos(maxLayers: number): Layer[][] {
  const out: Layer[][] = [[]]
  const walk = (start: number, cur: Layer[]) => {
    if (cur.length >= maxLayers) return
    for (let i = start; i < LAYER_TYPES.length; i++) {
      const next = [...cur, LAYER_TYPES[i]]
      out.push(next)
      walk(i, next)
    }
  }
  walk(0, [])
  return out
}

const COMBOS = layerCombos(3)

export function solveHeight(input: {
  finalHeight: number
  plyThickness: number
  tatamiThickness: number
  binH: number
  drawers: boolean
}): HeightSolution {
  const target = input.finalHeight - input.plyThickness - input.tatamiThickness
  const required = requiredSupport(input.binH, input.drawers)
  const minFinalHeight = required + input.plyThickness + input.tatamiThickness
  const fits = target + 1e-9 >= required
  const base = { target, required, fits, minFinalHeight }
  if (target < 1) {
    return { ...base, options: [], message: 'Final height is too low for the plywood + tatami layers.' }
  }

  const options: HeightOption[] = []
  let n = 0
  for (const joist of JOIST_SIZES) {
    for (const combo of COMBOS) {
      const achieved = joist.d + combo.reduce((s, l) => s + l.t, 0)
      const error = achieved - target
      if (Math.abs(error) <= TOLERANCE) {
        options.push({
          id: `opt${n++}`,
          label: describe(joist.key, undefined, combo),
          joist,
          depth: joist.d,
          layers: combo,
          achieved,
          error,
          exact: true,
        })
      }
    }
  }
  const ripBase = JOIST_SIZES.find((j) => j.d >= target)
  if (ripBase && target >= 1) {
    options.push({
      id: `opt${n++}`,
      label: describe(ripBase.key, target, []),
      joist: ripBase,
      ripTo: target,
      depth: target,
      layers: [],
      achieved: target,
      error: 0,
      exact: true,
    })
  }

  const score = (o: HeightOption) =>
    o.layers.length * 10 + (o.ripTo ? 25 : 0) + JOIST_SIZES.findIndex((j) => j.key === o.joist.key)
  options.sort((a, b) => score(a) - score(b))
  // keep only the best option per (joist, layer signature)
  const seen = new Set<string>()
  const uniq = options.filter((o) => {
    const k = `${o.joist.key}|${o.ripTo ?? ''}|${o.layers.map((l) => l.name).join('+')}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return {
    ...base,
    options: uniq.slice(0, 6),
    message: fits
      ? undefined
      : `Bin + clearance needs ${required.toFixed(2)}" of support height but only ${target.toFixed(2)}" is available. Raise the final height to at least ${minFinalHeight.toFixed(2)}".`,
  }
}

function describe(joistKey: string, ripTo: number | undefined, layers: Layer[]): string {
  const base = ripTo ? `${joistKey} ripped to ${ripTo.toFixed(3)}" on edge` : `${joistKey} on edge`
  if (!layers.length) return base
  return `${base} + ${layers.map((l) => l.name).join(' + ')}`
}
