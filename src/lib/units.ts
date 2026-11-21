export type UnitSystem = 'imperial' | 'metric'

export const MM_PER_IN = 25.4

export function inToMm(v: number): number {
  return v * MM_PER_IN
}
export function mmToIn(v: number): number {
  return v / MM_PER_IN
}

/** Format inches as a carpenter fraction, e.g. 38 1/2" (nearest 1/16). */
export function formatInches(inches: number, denom = 16): string {
  const neg = inches < 0
  const abs = Math.abs(inches)
  let whole = Math.floor(abs)
  let num = Math.round((abs - whole) * denom)
  if (num === denom) {
    whole += 1
    num = 0
  }
  let n = num
  let d = denom
  while (n > 0 && n % 2 === 0) {
    n /= 2
    d /= 2
  }
  const frac = n > 0 ? `${n}/${d}` : ''
  const body = whole > 0 && frac ? `${whole} ${frac}` : frac || `${whole}`
  return `${neg ? '-' : ''}${body}"`
}

export function formatLength(inches: number, system: UnitSystem): string {
  if (system === 'metric') return `${Math.round(inToMm(inches))} mm`
  return formatInches(inches)
}

/** Parse "38 1/2", "38.5", "3' 2", "1/2", "3'" into inches. Returns NaN on failure. */
export function parseImperial(text: string): number {
  const s = text.trim().replace(/["”]/g, '').replace(/ft|foot|feet/gi, "'").replace(/in(ches)?/gi, '')
  if (!s) return NaN
  let feet = 0
  let rest = s
  const m = s.match(/^(\d+(?:\.\d+)?)\s*'\s*(.*)$/)
  if (m) {
    feet = parseFloat(m[1])
    rest = m[2].trim()
  }
  let inches = 0
  if (rest) {
    const parts = rest.split(/\s+/)
    for (const p of parts) {
      const f = p.match(/^(\d+)\/(\d+)$/)
      if (f) {
        const den = parseInt(f[2], 10)
        if (den === 0) return NaN
        inches += parseInt(f[1], 10) / den
      } else if (/^\d+(\.\d+)?$/.test(p)) {
        inches += parseFloat(p)
      } else {
        return NaN
      }
    }
  }
  return feet * 12 + inches
}

/** Parse a user-entered length into inches using the active unit system. */
export function parseLength(text: string, system: UnitSystem): number {
  if (system === 'metric') {
    const v = parseFloat(text.replace(/mm/i, ''))
    return Number.isFinite(v) ? mmToIn(v) : NaN
  }
  return parseImperial(text)
}

/** Value shown in an input box (no unit suffix). */
export function toInputText(inches: number, system: UnitSystem): string {
  if (system === 'metric') return String(Math.round(inToMm(inches) * 10) / 10)
  return formatInches(inches).replace('"', '')
}

export function round(v: number, digits = 3): number {
  const p = 10 ** digits
  return Math.round(v * p) / p
}
