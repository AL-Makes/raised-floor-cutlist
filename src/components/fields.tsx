import { useEffect, useState } from 'react'
import { parseLength, toInputText, type UnitSystem } from '../lib/units'

export function LenInput({
  label,
  value,
  onChange,
  units,
  min = 0,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  units: UnitSystem
  min?: number
  hint?: string
}) {
  const [text, setText] = useState(toInputText(value, units))
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(toInputText(value, units))
    setBad(false)
  }, [value, units])
  const commit = () => {
    const v = parseLength(text, units)
    if (Number.isFinite(v) && v >= min) {
      setBad(false)
      onChange(v)
      setText(toInputText(v, units))
    } else setBad(true)
  }
  return (
    <label className="field">
      <span>
        {label} <em>{units === 'metric' ? 'mm' : 'in'}</em>
      </span>
      <input
        inputMode={units === 'metric' ? 'decimal' : 'text'}
        value={text}
        className={bad ? 'bad' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function NumInput({ label, value, onChange, min = 0, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number; suffix?: string }) {
  return (
    <label className="field">
      <span>
        {label} {suffix && <em>{suffix}</em>}
      </span>
      <input type="number" inputMode="decimal" min={min} step={step} value={value} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />
    </label>
  )
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}
