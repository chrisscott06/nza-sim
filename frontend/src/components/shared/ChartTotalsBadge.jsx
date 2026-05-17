/**
 * ChartTotalsBadge.jsx — Brief 28-IM-Polish §4.1 / Bug 2.10
 *
 * Top-right badge for any chart showing the sum of what's plotted, in
 * both absolute (MWh/yr) and intensity (kWh/m²·yr) units side-by-side.
 * Matches the brief's q50 unit-toggle pattern: "show both, no toggle
 * needed."
 *
 * Props:
 *   label?:        prefix, e.g. "Σ losses" (default "Σ")
 *   value_kwh:     total in kWh
 *   gia_m2:        floor area for intensity calc; omit to skip intensity
 *   engineMode?:   'static' | 'dynamic' | 'both' — annotates which engine
 *                  produced the total (when present, suffixes "(Static)" /
 *                  "(Dynamic)" so two badges side-by-side are easy to read)
 *
 * Renders auto-scaled units:
 *   < 100 kWh   → "X kWh"
 *   < 1000 kWh  → "XXX kWh"
 *   >= 1000     → "X.X MWh"
 */

function _fmtAbsolute(kwh) {
  if (!Number.isFinite(kwh)) return '—'
  const abs = Math.abs(kwh)
  if (abs < 100)   return `${Math.round(kwh)} kWh`
  if (abs < 1000)  return `${Math.round(kwh)} kWh`
  return `${(kwh / 1000).toFixed(1)} MWh`
}

function _fmtIntensity(kwh, gia) {
  if (!Number.isFinite(kwh) || !Number.isFinite(gia) || gia <= 0) return null
  const v = kwh / gia
  return `${v.toFixed(1)} kWh/m²·yr`
}

export default function ChartTotalsBadge({ label = 'Σ', value_kwh, gia_m2, engineMode, className = '' }) {
  const absolute  = _fmtAbsolute(value_kwh)
  const intensity = _fmtIntensity(value_kwh, gia_m2)
  const engineSuffix = engineMode
    ? ` (${engineMode === 'both' ? 'Static + Dynamic' : engineMode === 'dynamic' ? 'Dynamic' : 'Static'})`
    : ''
  return (
    <div className={`inline-flex items-baseline gap-2 px-2 py-0.5 rounded border border-light-grey bg-off-white text-xxs tabular-nums ${className}`}>
      <span className="text-mid-grey">{label}</span>
      <span className="text-navy font-semibold">{absolute}</span>
      {intensity && (
        <>
          <span className="text-mid-grey">·</span>
          <span className="text-navy">{intensity}</span>
        </>
      )}
      {engineSuffix && <span className="text-mid-grey/80 italic">{engineSuffix}</span>}
    </div>
  )
}
