/**
 * ReconciliationRow.jsx — Brief 28-IM-Polish POL-M3 §7.2
 *
 * Debugging-aid row used by each module's Summary view to verify that the
 * same total computed via two different upstream paths agrees. If the
 * engine's per-element annual `*_kwh` and its per-element monthly
 * `monthly_*_kwh[12]` arrays come out of the same physics step, they MUST
 * sum to the same number — otherwise there's a parser bug, an aggregation
 * bug, or a unit mismatch. Surface it visually:
 *
 *     Heat Balance:  99.4 MWh   =   Monthly:  99.4 MWh   ✓
 *
 * Tolerance: 0.5% by default (engine arithmetic is float-stable; anything
 * larger is suspicious). Caller can pass `tolerance_pct` to relax.
 *
 * Renders as a compact strip — one row per metric. Designed to slot into a
 * <SectionCard> at the bottom of the Summary view.
 *
 * Props:
 *   rows: [{ label, a_label, a_value, b_label, b_value, unit, tolerance_pct? }]
 *   unit defaults to 'MWh' (callers pre-divide /1000 from kWh)
 */

import { CheckCircle2, AlertTriangle } from 'lucide-react'

function _agree(a, b, tol_pct) {
  if (a == null || b == null) return false
  const max = Math.max(Math.abs(a), Math.abs(b), 0.001)
  return Math.abs(a - b) / max <= (tol_pct ?? 0.5) / 100
}

function _fmt(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—'
  const decimals = Math.abs(v) >= 10 ? 1 : 2
  return `${v.toFixed(decimals)} ${unit}`
}

export default function ReconciliationRow({ rows }) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const tol = r.tolerance_pct ?? 0.5
        const ok = _agree(r.a_value, r.b_value, tol)
        const unit = r.unit ?? 'MWh'
        return (
          <div
            key={r.label + i}
            className={`flex items-center justify-between gap-3 px-3 py-1.5 rounded border ${
              ok ? 'border-light-grey bg-white' : 'border-amber-300 bg-amber-50/60'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xxs uppercase tracking-wider text-mid-grey">{r.label}</p>
              <p className="text-caption text-navy tabular-nums mt-0.5">
                <span className="text-mid-grey">{r.a_label}:</span>{' '}
                <span className="font-medium">{_fmt(r.a_value, unit)}</span>
                <span className="text-mid-grey mx-2">=</span>
                <span className="text-mid-grey">{r.b_label}:</span>{' '}
                <span className="font-medium">{_fmt(r.b_value, unit)}</span>
              </p>
            </div>
            {ok ? (
              <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
            ) : (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <AlertTriangle size={16} className="text-amber-600" />
                <span className="text-xxs text-amber-700 tabular-nums">
                  Δ {Math.abs((r.a_value ?? 0) - (r.b_value ?? 0)).toFixed(2)} {unit}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
